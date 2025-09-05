import { PrismaClient } from "@prisma/client";
import type { Message } from "@voltagent/core";
import { BaseRetriever, createTool } from "@voltagent/core";
import { z } from "zod";
import { EmbeddingStorageService } from "../services/embedding-storage.service";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("KnowledgeRetriever");

const DEFAULT_SEARCH_OPTIONS = {
	limit: 3,
	threshold: 0.8,
	recencyWeight: 0.1,
	webBoostScore: 0.2,
	multiSearchBoost: 0.1,
	defaultDateRange: 30,
} as const;

const WEB_SEARCH_KEYWORDS = [
	"recent",
	"latest",
	"current",
	"news",
	"today",
	"this week",
	"this month",
	"2024",
	"2025",
	"now",
	"update",
	"what's new",
	"breaking",
] as const;

export interface KnowledgeDocument {
	id: string;
	title: string;
	content: string;
	url?: string;
	source: string;
	sourceType: string;
	summary?: string;
	metadata?: any;
	embedding?: number[];
	similarity?: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface SearchOptions {
	limit?: number;
	threshold?: number;
	source?: string;
	sourceType?: string;
	searchMode?: "text" | "vector" | "hybrid" | "web" | "hybrid_web";
	includeWeb?: boolean;
	dateFrom?: Date;
	dateTo?: Date;
	recencyWeight?: number;
	webSearchQuery?: string;
}

export class KnowledgeRetriever extends BaseRetriever {
	private prisma: PrismaClient;
	private embeddingService: EmbeddingStorageService;

	constructor() {
		super();
		this.prisma = new PrismaClient();
		this.embeddingService = EmbeddingStorageService.getInstance();
	}

	/**
	 * Main retrieve method for RAG integration
	 */
	async retrieve(
		input: string | Message[],
		options?: { limit?: number; threshold?: number; includeWeb?: boolean }
	): Promise<string> {
		const query = this.extractQueryFromInput(input);
		if (!query.trim()) {
			return "No query provided.";
		}

		try {
			logger.info("RAG retrieval started", { query: query.substring(0, 100) });

			const searchOptions = this.buildSearchOptions(options, query);
			const rawResults = await this.hybridSearch(query, searchOptions);
			const results = this.filterValidResults(rawResults);

			if (results.length === 0) {
				return await this.handleNoResults(query, searchOptions);
			}

			return this.formatResultsForRAG(results);
		} catch (error) {
			return this.handleError("Error in knowledge retrieval", error);
		}
	}

	/**
	 * Extract query string from input
	 */
	private extractQueryFromInput(input: string | Message[]): string {
		return typeof input === "string" ? input : input[input.length - 1]?.content || "";
	}

	/**
	 * Build search options with defaults and web search detection
	 */
	private buildSearchOptions(
		options?: { limit?: number; threshold?: number; includeWeb?: boolean },
		query?: string
	): SearchOptions {
		// Always disable web search to prevent irrelevant information
		const shouldIncludeWeb = false;
		return {
			limit: options?.limit || 3,
			threshold: options?.threshold || DEFAULT_SEARCH_OPTIONS.threshold,
			searchMode: shouldIncludeWeb ? "hybrid_web" : "hybrid",
			includeWeb: shouldIncludeWeb,
			recencyWeight: 0.2,
		};
	}

	/**
	 * Handle case when no results are found
	 */
	private async handleNoResults(query: string, searchOptions: SearchOptions): Promise<string> {
		if (searchOptions.includeWeb) {
			logger.info("No results with web search, retrying without web");
			const fallbackResults = await this.hybridSearch(query, {
				...searchOptions,
				searchMode: "hybrid",
				includeWeb: false,
			});

			if (fallbackResults.length > 0) {
				return this.formatResultsForRAG(fallbackResults);
			}
		}
		return "No relevant documents found.";
	}

	/**
	 * Determine if web search should be used based on query characteristics
	 */
	private shouldUseWebSearch(query: string): boolean {
		// Always return false to disable web search
		return false;
	}

	/**
	 * Centralized error handling
	 */
	private handleError(context: string, error: unknown): string {
		logger.error(context, error);
		return `${context}: ${error instanceof Error ? error.message : "Unknown error"}`;
	}

	/**
	 * Build dynamic WHERE conditions for SQL queries
	 */
	private buildSqlWhereConditions(
		options: SearchOptions,
		baseCondition: string
	): { whereClause: string; params: any[] } {
		const { source, sourceType, dateFrom, dateTo } = options;
		let whereConditions = baseCondition;
		const queryParams: any[] = [];

		if (source) {
			whereConditions += ` AND source = $${queryParams.length + 2}`;
			queryParams.push(source);
		}

		if (sourceType) {
			whereConditions += ` AND "sourceType" = $${queryParams.length + 2}`;
			queryParams.push(sourceType);
		}

		if (dateFrom) {
			whereConditions += ` AND "created_at" >= $${queryParams.length + 2}`;
			queryParams.push(dateFrom);
		}

		if (dateTo) {
			whereConditions += ` AND "created_at" <= $${queryParams.length + 2}`;
			queryParams.push(dateTo);
		}

		return { whereClause: whereConditions, params: queryParams };
	}

	/**
	 * Text-based search using PostgreSQL full-text search
	 */
	async textSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const limit = options.limit || DEFAULT_SEARCH_OPTIONS.limit;

		try {
			const baseCondition =
				"to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)";
			const { whereClause, params } = this.buildSqlWhereConditions(options, baseCondition);
			const allParams = [query, ...params, limit];

			const sqlQuery = `
				SELECT 
					id, title, content, url, source, "sourceType", 
					summary, metadata, "created_at" as "createdAt", "updated_at" as "updatedAt",
					ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', $1)) as rank
				FROM knowledge_documents 
				WHERE ${whereClause}
				ORDER BY rank DESC 
				LIMIT $${allParams.length}
			`;

			return await this.prisma.$queryRawUnsafe<KnowledgeDocument[]>(sqlQuery, ...allParams);
		} catch (error) {
			logger.error("Text search error:", error);
			return [];
		}
	}

	/**
	 * Build Prisma where clause for filtering
	 */
	private buildPrismaWhereClause(options: SearchOptions, baseWhere: any = {}): any {
		const { source, sourceType, dateFrom, dateTo } = options;
		const whereClause = { ...baseWhere };

		if (source) whereClause.source = source;
		if (sourceType) whereClause.sourceType = sourceType;
		if (dateFrom || dateTo) {
			whereClause.createdAt = {};
			if (dateFrom) whereClause.createdAt.gte = dateFrom;
			if (dateTo) whereClause.createdAt.lte = dateTo;
		}

		return whereClause;
	}

	/**
	 * Generate query embedding with validation
	 */
	private async generateQueryEmbedding(query: string): Promise<number[]> {
		if (!this.embeddingService.isEnabled()) {
			throw new Error("Embedding service not enabled");
		}

		const queryEmbedding = await this.embeddingService.generateEmbedding(query, "search_query");
		if (!queryEmbedding) {
			throw new Error("Failed to generate query embedding");
		}

		return queryEmbedding;
	}

	/**
	 * Calculate similarities and filter results by threshold
	 */
	private calculateSimilarities(
		documents: any[],
		queryEmbedding: number[],
		threshold: number
	): (KnowledgeDocument & { similarity: number })[] {
		const results: (KnowledgeDocument & { similarity: number })[] = [];

		for (const doc of documents) {
			if (doc.embedding && Array.isArray(doc.embedding)) {
				const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding as number[]);
				if (similarity >= threshold) {
					results.push({
						...doc,
						embedding: doc.embedding as number[],
						similarity,
					});
				}
			}
		}

		return results.sort((a, b) => b.similarity - a.similarity);
	}

	/**
	 * Vector-based similarity search using embeddings
	 */
	async vectorSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const limit = options.limit || DEFAULT_SEARCH_OPTIONS.limit;
		const threshold = options.threshold || DEFAULT_SEARCH_OPTIONS.threshold;

		try {
			const queryEmbedding = await this.generateQueryEmbedding(query);
			const whereClause = this.buildPrismaWhereClause(options, { embedding: { not: null } });

			const documents = await this.prisma.knowledgeDocument.findMany({
				where: whereClause,
				select: {
					id: true,
					title: true,
					content: true,
					url: true,
					source: true,
					sourceType: true,
					summary: true,
					metadata: true,
					embedding: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			const results = this.calculateSimilarities(documents, queryEmbedding, threshold);
			return results.slice(0, limit);
		} catch (error) {
			logger.error("Vector search error:", error);
			return [];
		}
	}

	/**
	 * Create mock web search result
	 */
	private createMockWebResult(searchQuery: string, index: number = 1): KnowledgeDocument {
		return {
			id: `web-${Date.now()}-${index}`,
			title: `Recent information about: ${searchQuery}`,
			content: `This is recent web content related to "${searchQuery}". This would be replaced with actual web search results from search APIs.`,
			url: `https://example.com/search?q=${encodeURIComponent(searchQuery)}`,
			source: "web_search",
			sourceType: "web",
			summary: `Recent web search result for: ${searchQuery}`,
			metadata: { searchQuery, timestamp: Date.now() },
			similarity: 0.8,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}

	/**
	 * Web search using search engines for recent information
	 */
	async webSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const limit = options.limit || DEFAULT_SEARCH_OPTIONS.limit;
		const searchQuery = options.webSearchQuery || query;

		try {
			logger.info("Performing web search", { query, limit });

			// TODO: Integrate with Google Search API, Bing Search API, or similar
			const mockWebResults = [this.createMockWebResult(searchQuery)];
			return mockWebResults.slice(0, limit);
		} catch (error) {
			logger.error("Web search error:", error);
			return [];
		}
	}

	/**
	 * Get default date range for recent search
	 */
	private getDefaultDateRange(dateFrom?: Date, dateTo?: Date): Date {
		if (dateFrom || dateTo) return dateFrom!;

		const defaultDate = new Date();
		defaultDate.setDate(defaultDate.getDate() - DEFAULT_SEARCH_OPTIONS.defaultDateRange);
		return defaultDate;
	}

	/**
	 * Search for recent documents within a date range
	 */
	async recentSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const { limit = DEFAULT_SEARCH_OPTIONS.limit, dateFrom, dateTo } = options;

		try {
			const defaultFromDate = this.getDefaultDateRange(dateFrom, dateTo);
			const searchFromDate = dateFrom || defaultFromDate;

			const baseCondition = `to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
						AND "created_at" >= $2${dateTo ? ' AND "created_at" <= $3' : ""}`;

			const queryParams = [query, searchFromDate];
			if (dateTo) queryParams.push(dateTo);
			queryParams.push(limit);

			const sqlQuery = `
				SELECT 
					id, title, content, url, source, "sourceType", 
					summary, metadata, "created_at" as "createdAt", "updated_at" as "updatedAt",
					ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', $1)) as rank
				FROM knowledge_documents 
				WHERE ${baseCondition}
				ORDER BY "created_at" DESC, rank DESC 
				LIMIT $${queryParams.length}
			`;

			return await this.prisma.$queryRawUnsafe<KnowledgeDocument[]>(sqlQuery, ...queryParams);
		} catch (error) {
			logger.error("Recent search error:", error);
			return [];
		}
	}

	/**
	 * Determine which search methods to use based on search mode
	 */
	private getSearchMethods(
		searchMode: string,
		includeWeb: boolean
	): {
		useText: boolean;
		useVector: boolean;
		useWeb: boolean;
	} {
		return {
			useText: ["text", "hybrid", "hybrid_web"].includes(searchMode),
			useVector: ["vector", "hybrid", "hybrid_web"].includes(searchMode),
			useWeb: false, // Always disable web search
		};
	}

	/**
	 * Calculate relevance score with bonuses
	 */
	private calculateRelevanceScore(result: KnowledgeDocument, recencyWeight: number): number {
		let baseScore = result.similarity || 0.5;

		// Apply recency bonus
		if (result.createdAt) {
			const daysSinceCreation = (Date.now() - result.createdAt.getTime()) / (1000 * 60 * 60 * 24);
			const recencyBonus = Math.max(0, (30 - daysSinceCreation) / 30) * recencyWeight;
			baseScore += recencyBonus;
		}

		// Boost web results for recent information
		if (result.sourceType === "web") {
			baseScore += DEFAULT_SEARCH_OPTIONS.webBoostScore;
		}

		return baseScore;
	}

	/**
	 * Combine and deduplicate search results
	 */
	private combineSearchResults(
		searchResults: KnowledgeDocument[][],
		options: SearchOptions
	): KnowledgeDocument[] {
		const resultMap = new Map<string, KnowledgeDocument>();
		const recencyWeight = options.recencyWeight || DEFAULT_SEARCH_OPTIONS.recencyWeight;

		for (const results of searchResults) {
			for (const result of results) {
				const existing = resultMap.get(result.id);
				const baseScore = this.calculateRelevanceScore(result, recencyWeight);

				if (existing) {
					// Boost score if found in multiple searches
					existing.similarity =
						Math.max(existing.similarity || 0, baseScore) + DEFAULT_SEARCH_OPTIONS.multiSearchBoost;
				} else {
					resultMap.set(result.id, {
						...result,
						similarity: baseScore,
					});
				}
			}
		}

		return Array.from(resultMap.values())
			.sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
			.slice(0, options.limit || DEFAULT_SEARCH_OPTIONS.limit);
	}

	/**
	 * Hybrid search combining text, vector, and optionally web search
	 */
	async hybridSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const {
			limit = DEFAULT_SEARCH_OPTIONS.limit,
			includeWeb = false,
			searchMode = "hybrid",
		} = options;

		try {
			logger.info("Performing hybrid search", { query, searchMode, includeWeb, limit });

			// Disable pure web search mode - fall back to hybrid search
			if (searchMode === "web") {
				logger.info("Web search mode disabled, using hybrid search instead");
			}

			const { useText, useVector, useWeb } = this.getSearchMethods(searchMode, includeWeb);
			const searches: Promise<KnowledgeDocument[]>[] = [];

			if (useText) {
				searches.push(this.textSearch(query, { ...options, limit: Math.ceil(limit * 1.5) }));
			}

			if (useVector) {
				searches.push(this.vectorSearch(query, { ...options, limit: Math.ceil(limit * 1.5) }));
			}

			if (useWeb) {
				searches.push(this.webSearch(query, { ...options, limit: Math.ceil(limit * 0.5) }));
			}

			const searchResults = await Promise.all(searches);
			return this.combineSearchResults(searchResults, options);
		} catch (error) {
			logger.error("Hybrid search error:", error);
			return this.textSearch(query, options);
		}
	}

	/**
	 * Validate URL to ensure it's not a placeholder/mock URL
	 */
	private isValidRealURL(url?: string): boolean {
		if (!url) return false;

		const placeholderDomains = [
			"example.com",
			"example.org",
			"example.net",
			"test.com",
			"placeholder.com",
			"mock.com",
			"demo.com",
		];

		return !placeholderDomains.some((domain) => url.includes(domain));
	}

	/**
	 * Filter out results with placeholder/mock URLs
	 */
	private filterValidResults(results: KnowledgeDocument[]): KnowledgeDocument[] {
		return results.filter((doc) => {
			// If there's a URL, validate it's not a placeholder
			if (doc.url && !this.isValidRealURL(doc.url)) {
				return false;
			}
			return true;
		});
	}

	/**
	 * Format search results for RAG context
	 */
	private formatResultsForRAG(results: KnowledgeDocument[]): string {
		return results
			.map((doc, index) => {
				const similarity = doc.similarity
					? ` (relevance: ${(doc.similarity * 100).toFixed(1)}%)`
					: "";
				const source = doc.url || doc.source;
				const sourceLabel = doc.sourceType === "web" ? "🌐 Web" : "📄 Knowledge Base";

				return `[Document ${index + 1}${similarity}] ${sourceLabel}
Title: ${doc.title}
Source: ${source}
Content: ${doc.content.length > 1000 ? `${doc.content.substring(0, 1000)}...` : doc.content}
${doc.summary ? `Summary: ${doc.summary}` : ""}`;
			})
			.join("\n\n---\n\n");
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error("Vectors must have the same length");
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	}

	/**
	 * Create a tool version of the retriever for agent use
	 */
	get tool() {
		return createTool({
			name: "search_knowledge_base",
			description:
				"Search the knowledge base for relevant documents and information. Use this to find specific information from stored documents, blog posts, and other knowledge sources. Supports web search for recent information.",
			parameters: z.object({
				query: z.string().describe("The search query or question"),
				limit: z.number().optional().describe("Maximum number of results to return (default: 3, max: 5)"),
				threshold: z
					.number()
					.optional()
					.describe("Minimum similarity threshold for vector search (0-1, default: 0.8)"),
				source: z
					.string()
					.optional()
					.describe("Filter by specific source (e.g., 'blog.aloha-corp.com')"),
				sourceType: z
					.string()
					.optional()
					.describe("Filter by source type (e.g., 'blog', 'pdf', 'text', 'web')"),
				searchMode: z
					.enum(["text", "vector", "hybrid"])
					.optional()
					.describe("Search method to use (default: 'hybrid')"),
				dateFrom: z.string().optional().describe("Filter results from this date (ISO string)"),
				dateTo: z.string().optional().describe("Filter results to this date (ISO string)"),
			}),
			execute: async (args) => {
				try {
					const searchOptions: SearchOptions = {
						limit: Math.min(args.limit || 3, 5), // Cap at maximum 5, default 3
						threshold: args.threshold || 0.8,
						source: args.source,
						sourceType: args.sourceType,
						searchMode: args.searchMode || "hybrid",
						includeWeb: false, // Always disabled
						dateFrom: args.dateFrom ? new Date(args.dateFrom) : undefined,
						dateTo: args.dateTo ? new Date(args.dateTo) : undefined,
						recencyWeight: 0.2,
					};

					const rawResults = await this.hybridSearch(args.query, searchOptions);
					const results = this.filterValidResults(rawResults);

					if (results.length === 0) {
						return {
							success: true,
							message: "No relevant documents found for your query.",
							query: args.query,
							results: [],
							searchType: searchOptions.searchMode,
							includedWeb: searchOptions.includeWeb,
						};
					}

					const dbResultsCount = results.length;

					return {
						success: true,
						message: `Found ${results.length} relevant document(s) from knowledge base`,
						query: args.query,
						results: results.map((doc) => ({
							title: doc.title,
							content: doc.content.substring(0, 500) + (doc.content.length > 500 ? "..." : ""),
							url: doc.url,
							source: doc.source,
							sourceType: doc.sourceType,
							summary: doc.summary,
							similarity: doc.similarity,
							createdAt: doc.createdAt,
						})),
						context: this.formatResultsForRAG(results),
						searchType: searchOptions.searchMode,
						includedWeb: false,
						dbResultsCount,
					};
				} catch (error) {
					logger.error("Knowledge search tool error:", error);
					return {
						success: false,
						error: error instanceof Error ? error.message : "Unknown error occurred",
						query: args.query,
					};
				}
			},
		});
	}

	/**
	 * Cleanup method
	 */
	async disconnect() {
		await this.prisma.$disconnect();
	}
}
