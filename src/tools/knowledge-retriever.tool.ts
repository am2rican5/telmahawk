import type { Tool } from "@voltagent/core";
import { KnowledgeRetriever } from "../retrievers/knowledge.retriever";
import type { ToolFactory } from "./types";

export class KnowledgeRetrieverToolFactory implements ToolFactory {
	private knowledgeRetriever: KnowledgeRetriever;

	constructor() {
		this.knowledgeRetriever = new KnowledgeRetriever();
	}

	create(): Tool {
		return this.knowledgeRetriever.tool;
	}
}
