import type { LanguageModelV2 } from "@ai-sdk/provider";
import { Agent, type Tool } from "@voltagent/core";
import type { SupabaseMemory } from "@voltagent/supabase";
import type { VercelAIProvider } from "@voltagent/vercel-ai";
import type { AgentFactory } from "./types";

export class CodeAgentFactory implements AgentFactory {
	create(
		llm: VercelAIProvider,
		model: LanguageModelV2,
		memory?: SupabaseMemory,
		tools?: Record<string, Tool>
	): Agent {
		return new Agent({
			name: "code-assistant",
			instructions: `You are a programming and development assistant accessed through Telegram.
			You specialize in:
			- Code review and debugging
			- Programming language help
			- Architecture suggestions
			- Best practices
			- Documentation assistance
			- Generating embeddings for code analysis using the text_embedding tool (returns ID for storage)
			- Retrieving stored embeddings using the get_embedding tool for code similarity analysis
			
			When generating embeddings for code, they are stored efficiently and you'll get back an ID.
			This allows for code similarity comparisons and semantic analysis without overwhelming responses.
			
			Provide code examples when helpful, but keep responses concise for Telegram chat.
			Use proper formatting for code blocks.`,
			llm,
			model,
			memory: memory || undefined,
			tools: tools || {},
		});
	}
}
