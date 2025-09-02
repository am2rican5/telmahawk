import { type Embedding, PrismaClient } from "@prisma/client";
import { embed } from "ai";
import { google } from "@ai-sdk/google";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("EmbeddingStorageService");

export interface CreateEmbeddingData {
	text: string;
	embedding: number[];
	model: string;
	taskType?: string;
	dimensions: number;
	metadata?: Record<string, any>;
}

export interface EmbeddingRecord {
	id: string;
	text: string;
	model: string;
	taskType?: string;
	dimensions: number;
	metadata?: Record<string, any>;
	createdAt: Date;
	updatedAt: Date;
}

export interface EmbeddingWithVector extends EmbeddingRecord {
	embedding: number[];
}

export class EmbeddingStorageService {
	private static instance: EmbeddingStorageService;
	private prisma: PrismaClient | null = null;
	private isInitialized = false;

	private constructor() {}

	public static getInstance(): EmbeddingStorageService {
		if (!EmbeddingStorageService.instance) {
			EmbeddingStorageService.instance = new EmbeddingStorageService();
		}
		return EmbeddingStorageService.instance;
	}

	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			logger.warn("EmbeddingStorageService already initialized");
			return;
		}

		try {
			logger.info("Initializing EmbeddingStorageService...");
			this.prisma = new PrismaClient();

			// Test connection
			await this.prisma.$connect();
			logger.info("Database connection established successfully");

			this.isInitialized = true;
			logger.info("EmbeddingStorageService initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize EmbeddingStorageService", error);
			this.prisma = null;
			throw error;
		}
	}

	public async shutdown(): Promise<void> {
		if (!this.isInitialized || !this.prisma) {
			return;
		}

		try {
			logger.info("Shutting down EmbeddingStorageService...");
			await this.prisma.$disconnect();
			this.prisma = null;
			this.isInitialized = false;
			logger.info("EmbeddingStorageService shutdown complete");
		} catch (error) {
			logger.error("Error during EmbeddingStorageService shutdown", error);
		}
	}

	public async saveEmbedding(data: CreateEmbeddingData): Promise<EmbeddingRecord> {
		if (!this.isInitialized || !this.prisma) {
			throw new Error("EmbeddingStorageService is not initialized");
		}

		try {
			logger.debug(`Saving embedding for text: "${data.text.substring(0, 50)}..."`);

			const embedding = await this.prisma.embedding.create({
				data: {
					text: data.text,
					embedding: data.embedding,
					model: data.model,
					taskType: data.taskType,
					dimensions: data.dimensions,
					metadata: data.metadata || null,
				},
				select: {
					id: true,
					text: true,
					model: true,
					taskType: true,
					dimensions: true,
					metadata: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			logger.info(`Embedding saved successfully with ID: ${embedding.id}`);
			return {
				...embedding,
				metadata: embedding.metadata as Record<string, any> | undefined,
			};
		} catch (error) {
			logger.error("Failed to save embedding", error);
			throw new Error("Failed to save embedding to database");
		}
	}

	public async getEmbedding(id: string): Promise<EmbeddingRecord | null> {
		if (!this.isInitialized || !this.prisma) {
			throw new Error("EmbeddingStorageService is not initialized");
		}

		try {
			logger.debug(`Retrieving embedding with ID: ${id}`);

			const embedding = await this.prisma.embedding.findUnique({
				where: { id },
				select: {
					id: true,
					text: true,
					model: true,
					taskType: true,
					dimensions: true,
					metadata: true,
					createdAt: true,
					updatedAt: true,
				},
			});

			if (!embedding) {
				logger.warn(`Embedding not found with ID: ${id}`);
				return null;
			}

			return {
				...embedding,
				metadata: embedding.metadata as Record<string, any> | undefined,
			};
		} catch (error) {
			logger.error(`Failed to retrieve embedding with ID: ${id}`, error);
			throw new Error("Failed to retrieve embedding from database");
		}
	}

	public async getEmbeddingVector(id: string): Promise<number[] | null> {
		if (!this.isInitialized || !this.prisma) {
			throw new Error("EmbeddingStorageService is not initialized");
		}

		try {
			logger.debug(`Retrieving embedding vector with ID: ${id}`);

			const embedding = await this.prisma.embedding.findUnique({
				where: { id },
				select: { embedding: true },
			});

			if (!embedding) {
				logger.warn(`Embedding vector not found with ID: ${id}`);
				return null;
			}

			return embedding.embedding as number[];
		} catch (error) {
			logger.error(`Failed to retrieve embedding vector with ID: ${id}`, error);
			throw new Error("Failed to retrieve embedding vector from database");
		}
	}

	public async getEmbeddingWithVector(id: string): Promise<EmbeddingWithVector | null> {
		if (!this.isInitialized || !this.prisma) {
			throw new Error("EmbeddingStorageService is not initialized");
		}

		try {
			logger.debug(`Retrieving full embedding with ID: ${id}`);

			const embedding = await this.prisma.embedding.findUnique({
				where: { id },
			});

			if (!embedding) {
				logger.warn(`Full embedding not found with ID: ${id}`);
				return null;
			}

			return {
				id: embedding.id,
				text: embedding.text,
				embedding: embedding.embedding as number[],
				model: embedding.model,
				taskType: embedding.taskType,
				dimensions: embedding.dimensions,
				metadata: embedding.metadata as Record<string, any> | undefined,
				createdAt: embedding.createdAt,
				updatedAt: embedding.updatedAt,
			};
		} catch (error) {
			logger.error(`Failed to retrieve full embedding with ID: ${id}`, error);
			throw new Error("Failed to retrieve full embedding from database");
		}
	}

	public async deleteEmbedding(id: string): Promise<boolean> {
		if (!this.isInitialized || !this.prisma) {
			throw new Error("EmbeddingStorageService is not initialized");
		}

		try {
			logger.debug(`Deleting embedding with ID: ${id}`);

			await this.prisma.embedding.delete({
				where: { id },
			});

			logger.info(`Embedding deleted successfully with ID: ${id}`);
			return true;
		} catch (error) {
			logger.error(`Failed to delete embedding with ID: ${id}`, error);
			return false;
		}
	}

	public async listEmbeddings(
		options: { model?: string; taskType?: string; limit?: number; offset?: number } = {}
	): Promise<EmbeddingRecord[]> {
		if (!this.isInitialized || !this.prisma) {
			throw new Error("EmbeddingStorageService is not initialized");
		}

		try {
			const { model, taskType, limit = 50, offset = 0 } = options;

			logger.debug(`Listing embeddings with filters: ${JSON.stringify(options)}`);

			const embeddings = await this.prisma.embedding.findMany({
				where: {
					...(model && { model }),
					...(taskType && { taskType }),
				},
				select: {
					id: true,
					text: true,
					model: true,
					taskType: true,
					dimensions: true,
					metadata: true,
					createdAt: true,
					updatedAt: true,
				},
				orderBy: {
					createdAt: "desc",
				},
				take: limit,
				skip: offset,
			});

			return embeddings.map((embedding) => ({
				...embedding,
				metadata: embedding.metadata as Record<string, any> | undefined,
			}));
		} catch (error) {
			logger.error("Failed to list embeddings", error);
			throw new Error("Failed to list embeddings from database");
		}
	}

	/**
	 * Generate embeddings using AI SDK (following existing embedding tool pattern)
	 */
	public async generateEmbedding(text: string, taskType?: string): Promise<number[] | null> {
		try {
			// Initialize if not already done
			if (!this.isInitialized) {
				await this.initialize();
			}

			// Check for API key
			const apiKey = process.env.LLM_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
			if (!apiKey) {
				logger.warn("No API key found for embedding generation");
				return null;
			}

			// Use Google embedding model (following the existing pattern)
			const modelName = "gemini-embedding-001";
			const model = google.textEmbedding(modelName);

			// Set up provider options with task type and dimensionality
			const providerOptions: Record<string, any> = {
				google: {
					outputDimensionality: 768,
				},
			};

			// Map task type to Google's format
			if (taskType) {
				const taskTypeMap: Record<string, string> = {
					"search_query": "RETRIEVAL_QUERY",
					"document": "RETRIEVAL_DOCUMENT", 
					"similarity": "SEMANTIC_SIMILARITY",
					"clustering": "CLUSTERING",
					"classification": "CLASSIFICATION"
				};
				providerOptions.google.taskType = taskTypeMap[taskType] || "RETRIEVAL_DOCUMENT";
			} else {
				providerOptions.google.taskType = "RETRIEVAL_DOCUMENT";
			}

			logger.debug(`Generating embedding using Google model: ${modelName}, taskType: ${providerOptions.google.taskType}`);

			const result = await embed({
				model,
				value: text,
				providerOptions: providerOptions,
			});

			logger.debug(`Embedding generated successfully (${result.embedding.length} dimensions)`);
			return result.embedding;

		} catch (error) {
			logger.error("Failed to generate embedding", error);
			return null;
		}
	}

	public isEnabled(): boolean {
		// Check if we have API keys for embedding generation
		const hasApiKey = !!(process.env.LLM_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
		return this.isInitialized && this.prisma !== null && hasApiKey;
	}
}
