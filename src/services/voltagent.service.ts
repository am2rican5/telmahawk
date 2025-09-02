import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { Agent, VoltAgent } from "@voltagent/core";
import { VercelAIProvider } from "@voltagent/vercel-ai";
import config from "../config/config";
import { BotLogger } from "../utils/logger";

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

			const generalAgent = new Agent({
				name: "general-assistant",
				instructions: `You are a helpful AI assistant accessed through a Telegram bot. 
				You can help with various tasks including:
				- Answering questions
				- Providing explanations
				- Helping with problem-solving
				- General conversation
				
				Keep your responses concise and helpful. You are communicating through Telegram, 
				so format your responses appropriately for chat messages.`,
				llm: llmProvider,
				model: this.getModelForProvider(),
			});

			const codeAgent = new Agent({
				name: "code-assistant",
				instructions: `You are a programming and development assistant accessed through Telegram.
				You specialize in:
				- Code review and debugging
				- Programming language help
				- Architecture suggestions
				- Best practices
				- Documentation assistance
				
				Provide code examples when helpful, but keep responses concise for Telegram chat.
				Use proper formatting for code blocks.`,
				llm: llmProvider,
				model: this.getModelForProvider(),
			});

			this.agents.set("general", generalAgent);
			this.agents.set("code", codeAgent);

			this.voltAgent = new VoltAgent({
				agents: {
					"general-assistant": generalAgent,
					"code-assistant": codeAgent,
				},
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
			this.agents.clear();
			this.voltAgent = null;
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

			const response = await agent.generateText(input.message);

			const content = response.text || "I'm sorry, I couldn't generate a response.";

			logger.info(`Generated response for user ${input.userId}`, {
				responseLength: content.length,
				agentType,
			});

			return {
				content,
				agentName: agentType,
				conversationId,
			};
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
		return `${userId}-${agentType}-${Date.now()}`;
	}
}
