import { PrismaClient } from "@prisma/client";
import type { Message } from "@voltagent/core";
import { BaseRetriever, createTool } from "@voltagent/core";
import { z } from "zod";
import { EmbeddingStorageService } from "../services/embedding-storage.service";

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
	searchMode?: "text" | "vector" | "hybrid";
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
		options?: { limit?: number; threshold?: number }
	): Promise<string> {
		// Extract query from input
		const query = typeof input === "string" ? input : input[input.length - 1]?.content || "";

		if (!query.trim()) {
			return "No query provided.";
		}

		try {
			// Use hybrid search by default for RAG
			const results = await this.hybridSearch(query, {
				limit: options?.limit || 5,
				threshold: options?.threshold || 0.7,
				searchMode: "hybrid",
			});

			if (results.length === 0) {
				return "No relevant documents found.";
			}

			// Format results for RAG context
			return this.formatResultsForRAG(results);
		} catch (error) {
			console.error("Error in knowledge retrieval:", error);
			return `Error retrieving knowledge: ${error instanceof Error ? error.message : "Unknown error"}`;
		}
	}

	/**
	 * Text-based search using PostgreSQL full-text search
	 */
	async textSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const { limit = 10, source, sourceType } = options;

		try {
			// Build dynamic WHERE conditions
			let whereConditions =
				"to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)";
			const queryParams: any[] = [query];

			if (source) {
				whereConditions += " AND source = $" + (queryParams.length + 1);
				queryParams.push(source);
			}

			if (sourceType) {
				whereConditions += ' AND "sourceType" = $' + (queryParams.length + 1);
				queryParams.push(sourceType);
			}

			// Add limit parameter
			queryParams.push(limit);

			const sqlQuery = `
				SELECT 
					id, title, content, url, source, "sourceType", 
					summary, metadata, "created_at" as "createdAt", "updated_at" as "updatedAt",
					ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', $1)) as rank
				FROM knowledge_documents 
				WHERE ${whereConditions}
				ORDER BY rank DESC 
				LIMIT $${queryParams.length}
			`;

			const results = await this.prisma.$queryRawUnsafe<KnowledgeDocument[]>(
				sqlQuery,
				...queryParams
			);

			return results;
		} catch (error) {
			console.error("Text search error:", error);
			return [];
		}
	}

	/**
	 * Vector-based similarity search using embeddings
	 */
	async vectorSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const { limit = 10, threshold = 0.7, source, sourceType } = options;

		try {
			// Generate embedding for query
			if (!this.embeddingService.isEnabled()) {
				throw new Error("Embedding service not enabled");
			}

			const queryEmbedding = await this.embeddingService.generateEmbedding(query, "search_query");
			if (!queryEmbedding) {
				throw new Error("Failed to generate query embedding");
			}

			// Calculate cosine similarity using pg_vector or manual calculation
			const whereClause: any = {
				embedding: { not: null },
			};

			if (source) whereClause.source = source;
			if (sourceType) whereClause.sourceType = sourceType;

			// First get documents with embeddings
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

			// Calculate similarities and filter by threshold
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

			// Sort by similarity and limit results
			return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
		} catch (error) {
			console.error("Vector search error:", error);
			return [];
		}
	}

	/**
	 * Hybrid search combining text and vector search
	 */
	async hybridSearch(query: string, options: SearchOptions = {}): Promise<KnowledgeDocument[]> {
		const { limit = 10 } = options;

		try {
			// Run both searches in parallel
			const [textResults, vectorResults] = await Promise.all([
				this.textSearch(query, { ...options, limit: Math.ceil(limit * 1.5) }),
				this.vectorSearch(query, { ...options, limit: Math.ceil(limit * 1.5) }),
			]);

			// Combine and deduplicate results
			const resultMap = new Map<string, KnowledgeDocument>();

			// Add text search results with base score
			for (const result of textResults) {
				resultMap.set(result.id, {
					...result,
					similarity: 0.5, // Base score for text match
				});
			}

			// Add or update with vector search results
			for (const result of vectorResults) {
				const existing = resultMap.get(result.id);
				if (existing && result.similarity) {
					// Boost score if found in both searches
					existing.similarity = Math.max(existing.similarity, result.similarity) + 0.1;
				} else if (result.similarity) {
					resultMap.set(result.id, result);
				}
			}

			// Sort by combined similarity and limit
			return Array.from(resultMap.values())
				.sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
				.slice(0, limit);
		} catch (error) {
			console.error("Hybrid search error:", error);
			// Fallback to text search only
			return this.textSearch(query, options);
		}
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

				return `[Document ${index + 1}${similarity}]
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
				"Search the knowledge base for relevant documents and information. Use this to find specific information from stored documents, blog posts, and other knowledge sources.",
			parameters: z.object({
				query: z.string().describe("The search query or question"),
				limit: z.number().optional().describe("Maximum number of results to return (default: 5)"),
				threshold: z
					.number()
					.optional()
					.describe("Minimum similarity threshold for vector search (0-1, default: 0.7)"),
				source: z
					.string()
					.optional()
					.describe("Filter by specific source (e.g., 'blog.aloha-corp.com')"),
				sourceType: z
					.string()
					.optional()
					.describe("Filter by source type (e.g., 'blog', 'pdf', 'text')"),
				searchMode: z
					.enum(["text", "vector", "hybrid"])
					.optional()
					.describe("Search method to use (default: 'hybrid')"),
			}),
			execute: async (args) => {
				try {
					const results = await this.hybridSearch(args.query, {
						limit: args.limit || 5,
						threshold: args.threshold || 0.7,
						source: args.source,
						sourceType: args.sourceType,
						searchMode: args.searchMode || "hybrid",
					});

					if (results.length === 0) {
						return {
							success: true,
							message: "No relevant documents found for your query.",
							query: args.query,
							results: [],
						};
					}

					return {
						success: true,
						message: `Found ${results.length} relevant document(s)`,
						query: args.query,
						results: results.map((doc) => ({
							title: doc.title,
							content: doc.content.substring(0, 500) + (doc.content.length > 500 ? "..." : ""),
							url: doc.url,
							source: doc.source,
							sourceType: doc.sourceType,
							summary: doc.summary,
							similarity: doc.similarity,
						})),
						context: this.formatResultsForRAG(results),
					};
				} catch (error) {
					console.error("Knowledge search tool error:", error);
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
