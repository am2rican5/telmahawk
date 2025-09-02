import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { Agent, Tool } from "@voltagent/core";
import type { SupabaseMemory } from "@voltagent/supabase";
import type { VercelAIProvider } from "@voltagent/vercel-ai";
import { CodeAgentFactory } from "./code.agent";
import { GeneralAgentFactory } from "./general.agent";
import { KnowledgeAgentFactory } from "./knowledge.agent";
import type { AgentFactory } from "./types";

export class AgentRegistry {
	private factories: Map<string, AgentFactory> = new Map();

	constructor() {
		this.registerDefaultAgents();
	}

	private registerDefaultAgents(): void {
		this.factories.set("general", new GeneralAgentFactory());
		this.factories.set("code", new CodeAgentFactory());
		this.factories.set("knowledge", new KnowledgeAgentFactory());
	}

	public register(key: string, factory: AgentFactory): void {
		this.factories.set(key, factory);
	}

	public createAgent(
		key: string,
		llm: VercelAIProvider,
		model: LanguageModelV2,
		memory?: SupabaseMemory,
		tools?: Record<string, Tool>
	): Agent | null {
		const factory = this.factories.get(key);
		if (!factory) {
			return null;
		}
		return factory.create(llm, model, memory, tools);
	}

	public getAvailableAgents(): string[] {
		return Array.from(this.factories.keys());
	}

	public hasAgent(key: string): boolean {
		return this.factories.has(key);
	}
}
