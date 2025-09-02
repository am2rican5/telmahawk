import type { Tool } from "@voltagent/core";

export interface ToolConfig {
	name: string;
	description: string;
}

export interface ToolFactory {
	create(): Tool;
}
