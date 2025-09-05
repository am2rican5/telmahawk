import type { Tool } from "@voltagent/core";
import { createTool } from "@voltagent/core";
import { z } from "zod";
import config from "../config/config";
import type { ToolFactory } from "./types";

const botIdentityTool = createTool({
	name: "who_am_i",
	description:
		"Get information about the bot's identity, including name, description, personality, capabilities, and version. Use this tool to understand who you are representing when responding to users.",
	parameters: z.object({}),
	execute: async () => {
		try {
			const identity = {
				name: config.identity.name,
				description: config.identity.description,
				personality: config.identity.personality,
				capabilities: config.identity.capabilities.split(",").map((cap) => cap.trim()),
				version: config.identity.version,
				timestamp: new Date().toISOString(),
			};

			return {
				success: true,
				identity,
				message: `I am ${identity.name}, ${identity.description}. My personality is: ${identity.personality}. My key capabilities include: ${identity.capabilities.join(", ")}.`,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
			throw new Error(`Failed to retrieve bot identity: ${errorMessage}`);
		}
	},
});

export class BotIdentityToolFactory implements ToolFactory {
	create(): Tool {
		return botIdentityTool;
	}
}
