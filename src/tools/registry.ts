import type { Tool } from "@voltagent/core";
import { EmbeddingToolFactory } from "./embedding.tool";
import { EmbeddingRetrievalToolFactory } from "./embedding-retrieval.tool";
import { KnowledgeRetrieverToolFactory } from "./knowledge-retriever.tool";
import type { ToolFactory } from "./types";
import { WebSearchToolFactory } from "./web-search-tool-factory";

export class ToolRegistry {
	private factories: Map<string, ToolFactory> = new Map();

	constructor() {
		this.registerDefaultTools();
	}

	private registerDefaultTools(): void {
		this.factories.set("embedding", new EmbeddingToolFactory());
		this.factories.set("get_embedding", new EmbeddingRetrievalToolFactory());
		this.factories.set("search_knowledge_base", new KnowledgeRetrieverToolFactory());
		this.factories.set("web_search", new WebSearchToolFactory());
	}

	public register(key: string, factory: ToolFactory): void {
		this.factories.set(key, factory);
	}

	public createTool(key: string): Tool | null {
		const factory = this.factories.get(key);
		if (!factory) {
			return null;
		}
		return factory.create();
	}

	public getAllTools(): Record<string, Tool> {
		const tools: Record<string, Tool> = {};
		for (const [key, factory] of this.factories) {
			const tool = factory.create();
			if (tool) {
				tools[key] = tool;
			}
		}
		return tools;
	}

	public getAvailableTools(): string[] {
		return Array.from(this.factories.keys());
	}

	public hasTool(key: string): boolean {
		return this.factories.has(key);
	}
}
