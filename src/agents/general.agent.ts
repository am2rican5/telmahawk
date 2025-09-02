import type { LanguageModelV2 } from "@ai-sdk/provider";
import { Agent, type Tool } from "@voltagent/core";
import type { SupabaseMemory } from "@voltagent/supabase";
import type { VercelAIProvider } from "@voltagent/vercel-ai";
import type { AgentFactory } from "./types";

export class GeneralAgentFactory implements AgentFactory {
	create(
		llm: VercelAIProvider,
		model: LanguageModelV2,
		memory?: SupabaseMemory,
		tools?: Record<string, Tool>
	): Agent {
		return new Agent({
			name: "general-assistant",
			instructions: `You are a helpful AI assistant accessed through a Telegram bot. 
			You can help with various tasks including:
			- Answering questions
			- Providing explanations
			- Helping with problem-solving
			- General conversation
			- Generating text embeddings using the text_embedding tool (returns ID for storage efficiency)
			- Retrieving stored embeddings using the get_embedding tool (with optional vector data)
			
			When generating embeddings, they are stored in a database and you'll get back an ID instead of the full vector.
			This makes responses manageable and allows for efficient retrieval later.
			
			Keep your responses concise and helpful. You are communicating through Telegram, 
			so format your responses appropriately for chat messages.`,
			llm,
			model,
			memory: memory || undefined,
			tools: tools || {},
		});
	}
}
