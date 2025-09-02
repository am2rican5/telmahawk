import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { type Agent, VoltAgent } from "@voltagent/core";
import { SupabaseMemory } from "@voltagent/supabase";
import { VercelAIProvider } from "@voltagent/vercel-ai";
import { AgentRegistry } from "../agents";
import config from "../config/config";
import { ToolRegistry } from "../tools";
import { BotLogger } from "../utils/logger";
import { EmbeddingStorageService } from "./embedding-storage.service";

const logger = new BotLogger("VoltagentService");

export interface AgentResponse {
	content: string;
	agentName: string;
	conversationId: string;
}

export interface ConversationInput {
	message: string;
	userId: string;
	conversationId?: string;
}

export class VoltagentService {
	private static instance: VoltagentService;
	private voltAgent: VoltAgent | null = null;
	private agents: Map<string, Agent> = new Map();
	private agentRegistry: AgentRegistry = new AgentRegistry();
	private toolRegistry: ToolRegistry = new ToolRegistry();
	private memory: SupabaseMemory | null = null;
	private embeddingStorage: EmbeddingStorageService = EmbeddingStorageService.getInstance();
	private isInitialized = false;

	private constructor() {}

	public static getInstance(): VoltagentService {
		if (!VoltagentService.instance) {
			VoltagentService.instance = new VoltagentService();
		}
		return VoltagentService.instance;
	}

	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			logger.warn("Voltagent service already initialized");
			return;
		}

		if (!config.voltagent.enabled) {
			logger.info("Voltagent is disabled in configuration");
			return;
		}

		try {
			logger.info("Initializing Voltagent service...");

			const llmProvider = this.createLLMProvider();

			// Initialize embedding storage if database is configured
			if (config.database?.url) {
				try {
					logger.info("Initializing embedding storage service...");
					await this.embeddingStorage.initialize();
					logger.info("Embedding storage service initialized successfully");
				} catch (storageError) {
					logger.error("Failed to initialize embedding storage service", storageError);
					logger.warn("Continuing without embedding storage - embeddings will not be saved");
				}
			}

			// Initialize memory if configured
			if (config.voltagent.memory) {
				try {
					logger.info("Initializing Supabase memory...");
					this.memory = new SupabaseMemory({
						supabaseUrl: config.voltagent.memory.supabaseUrl,
						supabaseKey: config.voltagent.memory.supabaseKey,
						tableName: config.voltagent.memory.tableName,
						storageLimit: config.voltagent.memory.storageLimit,
						debug: config.voltagent.memory.debug,
					});
					logger.info("Supabase memory initialized successfully");
				} catch (memoryError) {
					logger.error("Failed to initialize Supabase memory", memoryError);
					logger.warn("Continuing without memory - agents will work without persistent memory");
					this.memory = null;
				}
			}

			const llmModel = this.getModelForProvider();

			// Create tools using the registry
			const tools = this.toolRegistry.getAllTools();

			// Create agents using the registry
			for (const agentKey of this.agentRegistry.getAvailableAgents()) {
				const agent = this.agentRegistry.createAgent(
					agentKey,
					llmProvider,
					llmModel,
					this.memory || undefined,
					tools
				);
				if (agent) {
					this.agents.set(agentKey, agent);
				}
			}

			// Build agents object for VoltAgent
			const voltAgents: Record<string, Agent> = {};
			for (const [key, agent] of this.agents) {
				voltAgents[`${key}-assistant`] = agent;
			}

			this.voltAgent = new VoltAgent({
				agents: voltAgents,
			});

			this.isInitialized = true;
			logger.info("Voltagent service initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize Voltagent service", error);
			throw error;
		}
	}

	public async shutdown(): Promise<void> {
		if (!this.isInitialized) {
			return;
		}

		try {
			logger.info("Shutting down Voltagent service...");

			// Shutdown embedding storage
			await this.embeddingStorage.shutdown();

			this.agents.clear();
			this.voltAgent = null;
			this.memory = null;
			this.isInitialized = false;
			logger.info("Voltagent service shutdown complete");
		} catch (error) {
			logger.error("Error during Voltagent service shutdown", error);
		}
	}

	public async processMessage(
		input: ConversationInput,
		agentType: string = "general"
	): Promise<AgentResponse> {
		if (!this.isInitialized || !this.voltAgent) {
			throw new Error("Voltagent service is not initialized");
		}

		const agent = this.agents.get(agentType);
		if (!agent) {
			throw new Error(`Agent ${agentType} not found`);
		}

		try {
			logger.info(`Processing message for user ${input.userId} with agent ${agentType}`);

			const conversationId =
				input.conversationId || this.generateConversationId(input.userId, agentType);

			try {
				const response = await agent.generateText(input.message, {
					conversationId,
				});

				const content = response.text || "I'm sorry, I couldn't generate a response.";

				logger.info(`Generated response for user ${input.userId}`, {
					responseLength: content.length,
					agentType,
					hasMemory: this.memory !== null,
				});

				return {
					content,
					agentName: agentType,
					conversationId,
				};
			} catch (agentError) {
				// If memory fails, try without conversation context
				if (this.memory && agentError.message?.includes("memory")) {
					logger.warn("Memory error detected, retrying without conversation context", agentError);
					const response = await agent.generateText(input.message);
					const content = response.text || "I'm sorry, I couldn't generate a response.";

					return {
						content,
						agentName: agentType,
						conversationId,
					};
				}
				throw agentError;
			}
		} catch (error) {
			logger.error("Error processing message with Voltagent", error);
			throw new Error("Failed to process your message. Please try again later.");
		}
	}

	public getAvailableAgents(): string[] {
		return Array.from(this.agents.keys());
	}

	public isEnabled(): boolean {
		return config.voltagent.enabled && this.isInitialized;
	}

	private createLLMProvider(): VercelAIProvider {
		return new VercelAIProvider();
	}

	private getModelForProvider(): LanguageModelV2 {
		const { provider, model } = config.voltagent.llm;

		switch (provider) {
			case "openai":
				return openai(model);
			case "google":
				return google(model);
			default:
				throw new Error(`Unsupported LLM provider: ${provider}`);
		}
	}

	private generateConversationId(userId: string, agentType: string): string {
		// Create a stable conversation ID that persists across sessions
		// This allows the agent to maintain memory continuity per user-agent pair
		return `tg-${userId}-${agentType}`;
	}
}
