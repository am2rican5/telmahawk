import { PrismaClient } from "@prisma/client";
import { ContentFetcherService, type FetchedContent } from "./content-fetcher.service";
import { EmbeddingStorageService } from "./embedding-storage.service";
import { PlaywrightContentFetcherService } from "./playwright-content-fetcher.service";
import { SitemapService, type SitemapUrl } from "./sitemap.service";
import { type StibeeNewsletterItem, StibeeService } from "./stibee.service";

export interface IngestionResult {
	totalUrls: number;
	processedUrls: number;
	successfulIngestions: number;
	failedIngestions: number;
	errors: { url: string; error: string }[];
	duration: number;
}

export interface IngestionOptions {
	concurrency?: number;
	delayMs?: number;
	generateEmbeddings?: boolean;
	chunkLargeDocuments?: boolean;
	skipExisting?: boolean;
	onProgress?: (progress: {
		phase:
			| "fetching_sitemap"
			| "fetching_newsletter_list"
			| "fetching_content"
			| "generating_embeddings"
			| "storing_documents";
		completed: number;
		total: number;
		currentItem?: string;
	}) => void;
}

export class KnowledgeIngestionService {
	private prisma: PrismaClient;
	private sitemapService: SitemapService;
	private stibeeService: StibeeService;
	private contentFetcher: ContentFetcherService;
	private playwrightContentFetcher: PlaywrightContentFetcherService;
	private embeddingService: EmbeddingStorageService;

	constructor() {
		this.prisma = new PrismaClient();
		this.sitemapService = new SitemapService();
		this.stibeeService = new StibeeService();
		this.contentFetcher = new ContentFetcherService();
		this.playwrightContentFetcher = new PlaywrightContentFetcherService();
		this.embeddingService = EmbeddingStorageService.getInstance();
	}

	/**
	 * Initialize the ingestion service
	 */
	private async initialize(): Promise<void> {
		// Initialize embedding service if not already initialized
		if (!this.embeddingService.isEnabled()) {
			try {
				await this.embeddingService.initialize();
			} catch (error) {
				console.warn("Failed to initialize embedding service:", error);
			}
		}
	}

	/**
	 * Ingest all blog posts from Aloha Corp blog
	 */
	async ingestAlohaBlog(options: IngestionOptions = {}): Promise<IngestionResult> {
		const startTime = Date.now();
		const result: IngestionResult = {
			totalUrls: 0,
			processedUrls: 0,
			successfulIngestions: 0,
			failedIngestions: 0,
			errors: [],
			duration: 0,
		};

		try {
			// Initialize services
			await this.initialize();
			// Phase 1: Fetch sitemap
			options.onProgress?.({
				phase: "fetching_sitemap",
				completed: 0,
				total: 1,
				currentItem: "https://blog.aloha-corp.com/sitemap.xml",
			});

			console.log("🔍 Fetching Aloha blog sitemap...");
			const urls = await this.sitemapService.getAlohaBlogUrls();
			result.totalUrls = urls.length;

			console.log(`📄 Found ${urls.length} URLs in sitemap`);

			if (urls.length === 0) {
				console.log("No URLs found in sitemap");
				result.duration = Date.now() - startTime;
				return result;
			}

			// Phase 2: Process URLs
			const urlsToProcess = options.skipExisting
				? await this.filterExistingUrls(urls)
				: urls.map((u) => u.loc);

			console.log(
				`📝 Processing ${urlsToProcess.length} URLs (${options.skipExisting ? "skipping existing" : "including all"})`
			);

			const batchResult = await this.processBatchUrls(urlsToProcess, options);

			result.processedUrls = batchResult.length;
			result.successfulIngestions = batchResult.filter((r) => r.success).length;
			result.failedIngestions = batchResult.filter((r) => !r.success).length;
			result.errors = batchResult
				.filter((r) => !r.success)
				.map((r) => ({ url: r.url, error: r.error || "Unknown error" }));

			result.duration = Date.now() - startTime;

			console.log(`🎉 Ingestion completed in ${(result.duration / 1000).toFixed(1)}s`);
			console.log(`✅ Successful: ${result.successfulIngestions}`);
			console.log(`❌ Failed: ${result.failedIngestions}`);

			return result;
		} catch (error) {
			result.duration = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			result.errors.push({ url: "sitemap", error: errorMessage });
			console.error("❌ Ingestion failed:", errorMessage);
			throw error;
		}
	}

	/**
	 * Ingest all newsletters from Stibee
	 */
	async ingestStibeeNewsletter(options: IngestionOptions = {}): Promise<IngestionResult> {
		const startTime = Date.now();
		const result: IngestionResult = {
			totalUrls: 0,
			processedUrls: 0,
			successfulIngestions: 0,
			failedIngestions: 0,
			errors: [],
			duration: 0,
		};

		try {
			// Initialize services
			await this.initialize();

			// Phase 1: Fetch newsletter list
			options.onProgress?.({
				phase: "fetching_newsletter_list",
				completed: 0,
				total: 1,
				currentItem: "https://page.stibee.com/api/v1.0/lists/344703/contents",
			});

			console.log("🔍 Fetching Stibee newsletter list...");
			const newsletterUrls = await this.stibeeService.getNewsletterUrls();
			result.totalUrls = newsletterUrls.length;

			console.log(`📄 Found ${newsletterUrls.length} newsletters`);

			if (newsletterUrls.length === 0) {
				console.log("No newsletters found");
				result.duration = Date.now() - startTime;
				return result;
			}

			// Phase 2: Process URLs
			const urlsToProcess = options.skipExisting
				? await this.filterExistingNewsletterUrls(newsletterUrls)
				: newsletterUrls.map((n) => n.url);

			console.log(
				`📝 Processing ${urlsToProcess.length} newsletters (${options.skipExisting ? "skipping existing" : "including all"})`
			);

			const batchResult = await this.processNewsletterUrls(urlsToProcess, {
				...options,
				sourceType: "newsletter",
				sourceDomain: this.stibeeService.getDomain(),
			});

			result.processedUrls = batchResult.length;
			result.successfulIngestions = batchResult.filter((r) => r.success).length;
			result.failedIngestions = batchResult.filter((r) => !r.success).length;
			result.errors = batchResult
				.filter((r) => !r.success)
				.map((r) => ({ url: r.url, error: r.error || "Unknown error" }));

			result.duration = Date.now() - startTime;

			console.log(`🎉 Newsletter ingestion completed in ${(result.duration / 1000).toFixed(1)}s`);
			console.log(`✅ Successful: ${result.successfulIngestions}`);
			console.log(`❌ Failed: ${result.failedIngestions}`);

			return result;
		} catch (error) {
			result.duration = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			result.errors.push({ url: "newsletter_api", error: errorMessage });
			console.error("❌ Newsletter ingestion failed:", errorMessage);
			throw error;
		}
	}

	/**
	 * Process a batch of newsletter URLs using Playwright
	 */
	private async processNewsletterUrls(
		urls: string[],
		options: IngestionOptions & { sourceType?: string; sourceDomain?: string } = {}
	): Promise<{ url: string; success: boolean; error?: string; documentId?: string }[]> {
		const {
			concurrency = 2,
			delayMs = 2000,
			generateEmbeddings = true,
			chunkLargeDocuments = true,
			sourceType,
			sourceDomain,
		} = options;

		const results: { url: string; success: boolean; error?: string; documentId?: string }[] = [];

		// Phase 2: Fetch content using Playwright
		options.onProgress?.({
			phase: "fetching_content",
			completed: 0,
			total: urls.length,
		});

		try {
			const contentResults = await this.playwrightContentFetcher.fetchMultipleUrls(urls, {
				concurrency,
				delayMs,
				onProgress: (completed, total, currentUrl) => {
					options.onProgress?.({
						phase: "fetching_content",
						completed,
						total,
						currentItem: currentUrl,
					});
				},
			});

			// Phase 3: Process each successful content fetch
			let processed = 0;

			for (const contentResult of contentResults) {
				processed++;

				if (!contentResult.content) {
					results.push({
						url: contentResult.url,
						success: false,
						error: contentResult.error || "Failed to fetch content",
					});
					continue;
				}

				try {
					// Store document(s) in database
					options.onProgress?.({
						phase: "storing_documents",
						completed: processed,
						total: contentResults.length,
						currentItem: contentResult.url,
					});

					const documentIds = await this.storeDocument(contentResult.content, {
						generateEmbeddings,
						chunkLargeDocuments,
						sourceType,
						sourceDomain,
					});

					results.push({
						url: contentResult.url,
						success: true,
						documentId: documentIds[0], // Return main document ID
					});
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					results.push({
						url: contentResult.url,
						success: false,
						error: `Storage failed: ${errorMessage}`,
					});
				}
			}

			return results;
		} finally {
			// Ensure browser is cleaned up
			await this.playwrightContentFetcher.cleanup();
		}
	}

	/**
	 * Process a batch of URLs (original method for blog scraping)
	 */
	private async processBatchUrls(
		urls: string[],
		options: IngestionOptions & { sourceType?: string; sourceDomain?: string } = {}
	): Promise<{ url: string; success: boolean; error?: string; documentId?: string }[]> {
		const {
			concurrency = 3,
			delayMs = 1000,
			generateEmbeddings = true,
			chunkLargeDocuments = true,
			sourceType,
			sourceDomain,
		} = options;

		const results: { url: string; success: boolean; error?: string; documentId?: string }[] = [];

		// Phase 2: Fetch content
		options.onProgress?.({
			phase: "fetching_content",
			completed: 0,
			total: urls.length,
		});

		const contentResults = await this.contentFetcher.fetchMultipleUrls(urls, {
			concurrency,
			delayMs,
			onProgress: (completed, total, currentUrl) => {
				options.onProgress?.({
					phase: "fetching_content",
					completed,
					total,
					currentItem: currentUrl,
				});
			},
		});

		// Phase 3: Process each successful content fetch
		const successfulContents = contentResults.filter((r) => r.content);
		let processed = 0;

		for (const contentResult of contentResults) {
			processed++;

			if (!contentResult.content) {
				results.push({
					url: contentResult.url,
					success: false,
					error: contentResult.error || "Failed to fetch content",
				});
				continue;
			}

			try {
				// Store document(s) in database
				options.onProgress?.({
					phase: "storing_documents",
					completed: processed,
					total: contentResults.length,
					currentItem: contentResult.url,
				});

				const documentIds = await this.storeDocument(contentResult.content, {
					generateEmbeddings,
					chunkLargeDocuments,
					sourceType,
					sourceDomain,
				});

				results.push({
					url: contentResult.url,
					success: true,
					documentId: documentIds[0], // Return main document ID
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				results.push({
					url: contentResult.url,
					success: false,
					error: `Storage failed: ${errorMessage}`,
				});
			}
		}

		return results;
	}

	/**
	 * Store a document and optionally chunk it
	 */
	private async storeDocument(
		content: FetchedContent,
		options: {
			generateEmbeddings?: boolean;
			chunkLargeDocuments?: boolean;
			sourceType?: string;
			sourceDomain?: string;
		} = {}
	): Promise<string[]> {
		const {
			generateEmbeddings = true,
			chunkLargeDocuments = true,
			sourceType,
			sourceDomain,
		} = options;

		// Ensure services are initialized
		await this.initialize();

		// Check if document should be chunked
		const shouldChunk = chunkLargeDocuments && content.content.length > 3000;
		const documentIds: string[] = [];

		if (shouldChunk) {
			// Store as chunked documents
			const chunks = this.contentFetcher.chunkContent(content.content);

			// First create parent document
			const parentDocument = await this.prisma.knowledgeDocument.create({
				data: {
					title: content.title,
					url: content.url,
					source: sourceDomain || this.extractDomain(content.url),
					sourceType: sourceType || "blog",
					content: content.content,
					summary: content.summary,
					metadata: content.metadata,
					language: content.metadata.language || (sourceType === "newsletter" ? "ko" : "en"),
					totalChunks: chunks.length,
				},
			});

			documentIds.push(parentDocument.id);

			// Create chunk documents
			for (const chunk of chunks) {
				let embedding: number[] | undefined;

				if (generateEmbeddings && this.embeddingService.isEnabled()) {
					try {
						console.log(
							`  🧠 Generating embedding for chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks}...`
						);
						embedding = await this.embeddingService.generateEmbedding(chunk.content, "document");
						if (embedding) {
							console.log(`  ✅ Embedding generated (${embedding.length} dimensions)`);
						}
					} catch (error) {
						console.error("  ❌ Failed to generate embedding for chunk:", error);
					}
				}

				const chunkDoc = await this.prisma.knowledgeDocument.create({
					data: {
						title: `${content.title} (Part ${chunk.chunkIndex + 1})`,
						url: content.url,
						source: sourceDomain || this.extractDomain(content.url),
						sourceType: sourceType || "blog",
						content: chunk.content,
						embedding: embedding,
						model: embedding ? this.getEmbeddingModel() : undefined,
						dimensions: embedding?.length,
						parentId: parentDocument.id,
						chunkIndex: chunk.chunkIndex,
						chunkSize: chunk.chunkSize,
						totalChunks: chunk.totalChunks,
						language: content.metadata.language || (sourceType === "newsletter" ? "ko" : "en"),
						metadata: {
							...content.metadata,
							isChunk: true,
							parentTitle: content.title,
						},
					},
				});

				documentIds.push(chunkDoc.id);
			}
		} else {
			// Store as single document
			let embedding: number[] | undefined;

			if (generateEmbeddings && this.embeddingService.isEnabled()) {
				try {
					console.log(`  🧠 Generating embedding for document...`);
					embedding = await this.embeddingService.generateEmbedding(content.content, "document");
					if (embedding) {
						console.log(`  ✅ Embedding generated (${embedding.length} dimensions)`);
					}
				} catch (error) {
					console.error("  ❌ Failed to generate embedding:", error);
				}
			}

			const document = await this.prisma.knowledgeDocument.create({
				data: {
					title: content.title,
					url: content.url,
					source: sourceDomain || this.extractDomain(content.url),
					sourceType: sourceType || "blog",
					content: content.content,
					embedding: embedding,
					model: embedding ? this.getEmbeddingModel() : undefined,
					dimensions: embedding?.length,
					summary: content.summary,
					metadata: content.metadata,
					language: content.metadata.language || (sourceType === "newsletter" ? "ko" : "en"),
				},
			});

			documentIds.push(document.id);
		}

		return documentIds;
	}

	/**
	 * Filter out URLs that already exist in the database
	 */
	private async filterExistingUrls(sitemapUrls: SitemapUrl[]): Promise<string[]> {
		const urls = sitemapUrls.map((u) => u.loc);

		const existingDocuments = await this.prisma.knowledgeDocument.findMany({
			where: {
				url: { in: urls },
				parentId: null, // Only check parent documents, not chunks
			},
			select: { url: true },
		});

		const existingUrls = new Set(existingDocuments.map((d) => d.url));
		return urls.filter((url) => !existingUrls.has(url));
	}

	/**
	 * Filter out newsletter URLs that already exist in the database
	 */
	private async filterExistingNewsletterUrls(
		newsletterUrls: { id: number; url: string; title: string; publishedAt: string }[]
	): Promise<string[]> {
		const urls = newsletterUrls.map((n) => n.url);

		const existingDocuments = await this.prisma.knowledgeDocument.findMany({
			where: {
				url: { in: urls },
				parentId: null, // Only check parent documents, not chunks
			},
			select: { url: true },
		});

		const existingUrls = new Set(existingDocuments.map((d) => d.url));
		return urls.filter((url) => !existingUrls.has(url));
	}

	/**
	 * Extract domain from URL
	 */
	private extractDomain(url: string): string {
		try {
			return new URL(url).hostname;
		} catch {
			return "unknown";
		}
	}

	/**
	 * Get the embedding model name from environment or default
	 */
	private getEmbeddingModel(): string {
		const provider = process.env.LLM_PROVIDER || "openai";
		switch (provider) {
			case "google":
				return "gemini-embedding-001"; // Match the existing embedding tool
			case "openai":
			default:
				return "text-embedding-ada-002";
		}
	}

	/**
	 * Get ingestion statistics
	 */
	async getIngestionStats(): Promise<{
		totalDocuments: number;
		totalChunks: number;
		documentsBySource: { source: string; count: number }[];
		documentsWithEmbeddings: number;
		lastIngestionDate?: Date;
	}> {
		const [totalDocuments, totalChunks, documentsBySource, documentsWithEmbeddings, lastDocument] =
			await Promise.all([
				this.prisma.knowledgeDocument.count({
					where: { parentId: null },
				}),
				this.prisma.knowledgeDocument.count({
					where: { parentId: { not: null } },
				}),
				this.prisma.knowledgeDocument.groupBy({
					by: ["source"],
					where: { parentId: null },
					_count: { id: true },
				}),
				this.prisma.knowledgeDocument.count({
					where: {
						embedding: { not: null },
					},
				}),
				this.prisma.knowledgeDocument.findFirst({
					where: { parentId: null },
					orderBy: { createdAt: "desc" },
					select: { createdAt: true },
				}),
			]);

		return {
			totalDocuments,
			totalChunks,
			documentsBySource: documentsBySource.map((item) => ({
				source: item.source,
				count: item._count.id,
			})),
			documentsWithEmbeddings,
			lastIngestionDate: lastDocument?.createdAt,
		};
	}

	/**
	 * Cleanup method
	 */
	async disconnect(): Promise<void> {
		await this.prisma.$disconnect();
		await this.stibeeService.cleanup();
		await this.playwrightContentFetcher.cleanup();
	}
}
