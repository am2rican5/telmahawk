import type { Tool } from "@voltagent/core";
import { createTool } from "@voltagent/core";
import { z } from "zod";
import { EmbeddingStorageService } from "../services/embedding-storage.service";
import type { ToolFactory } from "./types";

const embeddingRetrievalTool = createTool({
	name: "get_embedding",
	description: "Retrieve stored embedding data by ID, with optional vector data",
	parameters: z.object({
		embeddingId: z.string().describe("The ID of the stored embedding to retrieve"),
		includeVector: z
			.boolean()
			.optional()
			.describe("Whether to include the actual embedding vector in the response (default: false)"),
	}),
	execute: async (args) => {
		try {
			const storageService = EmbeddingStorageService.getInstance();

			if (!storageService.isEnabled()) {
				throw new Error("Embedding storage service is not available");
			}

			if (args.includeVector) {
				// Get full embedding with vector
				const embedding = await storageService.getEmbeddingWithVector(args.embeddingId);

				if (!embedding) {
					return {
						success: false,
						error: "Embedding not found",
						embeddingId: args.embeddingId,
					};
				}

				return {
					success: true,
					embeddingId: embedding.id,
					text: embedding.text,
					embedding: embedding.embedding,
					model: embedding.model,
					taskType: embedding.taskType,
					dimensions: embedding.dimensions,
					metadata: embedding.metadata,
					createdAt: embedding.createdAt,
					updatedAt: embedding.updatedAt,
				};
			} else {
				// Get embedding metadata only
				const embedding = await storageService.getEmbedding(args.embeddingId);

				if (!embedding) {
					return {
						success: false,
						error: "Embedding not found",
						embeddingId: args.embeddingId,
					};
				}

				return {
					success: true,
					embeddingId: embedding.id,
					text: embedding.text,
					model: embedding.model,
					taskType: embedding.taskType,
					dimensions: embedding.dimensions,
					metadata: embedding.metadata,
					createdAt: embedding.createdAt,
					updatedAt: embedding.updatedAt,
				};
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			return {
				success: false,
				error: `Failed to retrieve embedding: ${errorMessage}`,
				embeddingId: args.embeddingId,
			};
		}
	},
});

export class EmbeddingRetrievalToolFactory implements ToolFactory {
	create(): Tool {
		return embeddingRetrievalTool;
	}
}
