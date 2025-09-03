import type { Tool } from "@voltagent/core";
import type { ToolFactory } from "./types";
import { webSearchTool } from "./web-search.tool";

export class WebSearchToolFactory implements ToolFactory {
	create(): Tool {
		return webSearchTool;
	}
}
