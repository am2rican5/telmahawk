import { google } from "@ai-sdk/google";
import type { Tool } from "@voltagent/core";
import { createTool } from "@voltagent/core";
import { embed } from "ai";
import { z } from "zod";
import { EmbeddingStorageService } from "../services/embedding-storage.service";
import type { ToolFactory } from "./types";

const embeddingTool = createTool({
	name: "text_embedding",
	description:
		"Generate text embeddings using Google AI embedding models for semantic similarity, clustering, and other AI tasks",
	parameters: z.object({
		text: z.string().describe("The text to generate embedding for"),
		taskType: z
			.enum([
				"SEMANTIC_SIMILARITY",
				"CLASSIFICATION",
				"CLUSTERING",
				"RETRIEVAL_DOCUMENT",
				"RETRIEVAL_QUERY",
				"QUESTION_ANSWERING",
				"FACT_VERIFICATION",
				"CODE_RETRIEVAL_QUERY",
			])
			.optional()
			.describe("The task type for which the embedding will be used"),
		returnVector: z
			.boolean()
			.optional()
			.describe("Whether to return the full embedding vector (default: false, returns only ID)"),
	}),
	execute: async (args) => {
		try {
			const modelName = "gemini-embedding-001";
			const model = google.textEmbedding(modelName);

			const providerOptions: Record<string, any> = {
				google: {
					outputDimensionality: 768,
				},
			};

			if (args.taskType) {
				providerOptions.google.taskType = args.taskType;
			}

			// Generate the embedding
			const result = await embed({
				model,
				value: args.text,
				providerOptions:
					Object.keys(providerOptions.google).length > 0 ? providerOptions : undefined,
			});

			const embeddingVector = result.embedding;
			const dimensions = embeddingVector.length;

			// Try to save to database if storage service is available
			const storageService = EmbeddingStorageService.getInstance();

			if (storageService.isEnabled()) {
				try {
					const savedEmbedding = await storageService.saveEmbedding({
						text: args.text,
						embedding: embeddingVector,
						model: modelName,
						taskType: args.taskType,
						dimensions,
						metadata: {
							usage: result.usage || null,
							providerOptions:
								Object.keys(providerOptions.google).length > 0 ? providerOptions : undefined,
						},
					});

					// Return ID-based response (default)
					if (!args.returnVector) {
						return {
							success: true,
							embeddingId: savedEmbedding.id,
							stored: true,
							dimensions,
							model: modelName,
							text: args.text,
							taskType: args.taskType,
							createdAt: savedEmbedding.createdAt,
							usage: result.usage || null,
						};
					}

					// Return full vector if requested
					return {
						success: true,
						embeddingId: savedEmbedding.id,
						embedding: embeddingVector,
						stored: true,
						dimensions,
						model: modelName,
						text: args.text,
						taskType: args.taskType,
						createdAt: savedEmbedding.createdAt,
						usage: result.usage || null,
					};
				} catch (storageError) {
					// If storage fails, still return the embedding but mark as not stored
					return {
						success: true,
						embedding: args.returnVector ? embeddingVector : undefined,
						stored: false,
						storageError: storageError instanceof Error ? storageError.message : "Storage failed",
						dimensions,
						model: modelName,
						text: args.text,
						taskType: args.taskType,
						usage: result.usage || null,
					};
				}
			}

			// If storage service is not available, return the embedding directly
			return {
				success: true,
				embedding: embeddingVector,
				stored: false,
				dimensions,
				model: modelName,
				text: args.text,
				taskType: args.taskType,
				usage: result.usage || null,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			throw new Error(`Failed to generate embedding: ${errorMessage}`);
		}
	},
});

export class EmbeddingToolFactory implements ToolFactory {
	create(): Tool {
		return embeddingTool;
	}
}
