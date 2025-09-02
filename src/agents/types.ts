import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { Agent, Tool } from "@voltagent/core";
import type { SupabaseMemory } from "@voltagent/supabase";
import type { VercelAIProvider } from "@voltagent/vercel-ai";

export interface AgentConfig {
	name: string;
	instructions: string;
}

export interface AgentFactory {
	create(
		llm: VercelAIProvider,
		model: LanguageModelV2,
		memory?: SupabaseMemory,
		tools?: Record<string, Tool>
	): Agent;
}
