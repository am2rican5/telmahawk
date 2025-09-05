import * as dotenv from "dotenv";
import type { PollingOptions } from "node-telegram-bot-api";

dotenv.config();

export interface Config {
	bot: {
		token: string;
		polling: PollingOptions;
		webhook?: {
			domain: string;
			path: string;
			port: number;
		};
	};
	server: {
		port: number;
		environment: string;
	};
	logging: {
		level: string;
	};
	admin: {
		userIds: number[];
	};
	rateLimit: {
		windowMs: number;
		maxRequests: number;
	};
	database?: {
		url: string;
	};
	voltagent: {
		enabled: boolean;
		llm: {
			provider: string;
			apiKey: string;
			model: string;
		};
		port: number;
		memory?: {
			supabaseUrl: string;
			supabaseKey: string;
			tableName?: string;
			storageLimit?: number;
			debug?: boolean;
		};
	};
	identity: {
		name: string;
		description: string;
		personality: string;
		capabilities: string;
		version: string;
	};
}

function parseAdminIds(adminIdsString?: string): number[] {
	if (!adminIdsString) return [];
	return adminIdsString
		.split(",")
		.map((id) => parseInt(id.trim(), 10))
		.filter((id) => !Number.isNaN(id));
}

const config: Config = {
	bot: {
		token: process.env.BOT_TOKEN || "",
		polling: {
			interval: 300,
			autoStart: false,
			params: {
				timeout: 10,
				allowed_updates: ["message", "callback_query", "inline_query"],
			},
		},
	},
	server: {
		port: parseInt(process.env.PORT || "3000", 10),
		environment: process.env.NODE_ENV || "development",
	},
	logging: {
		level: process.env.LOG_LEVEL || "info",
	},
	admin: {
		userIds: parseAdminIds(process.env.ADMIN_USER_IDS),
	},
	rateLimit: {
		windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
		maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "30", 10),
	},
	voltagent: {
		enabled: process.env.VOLTAGENT_ENABLED === "true",
		llm: {
			provider: process.env.LLM_PROVIDER || "openai",
			apiKey: process.env.LLM_API_KEY || "",
			model: process.env.LLM_MODEL || "gpt-4o-mini",
		},
		port: parseInt(process.env.VOLTAGENT_PORT || "3141", 10),
	},
	identity: {
		name: process.env.BOT_NAME || "Telmahawk",
		description:
			process.env.BOT_DESCRIPTION ||
			"An intelligent Telegram bot specializing in game industry knowledge and expertise",
		personality:
			process.env.BOT_PERSONALITY ||
			"Professional, knowledgeable, and helpful game industry consultant",
		capabilities:
			process.env.BOT_CAPABILITIES ||
			"Game industry research, market analysis, development insights, trend identification, and strategic guidance",
		version: process.env.BOT_VERSION || "1.0.0",
	},
};

if (process.env.WEBHOOK_DOMAIN && process.env.WEBHOOK_PATH) {
	config.bot.webhook = {
		domain: process.env.WEBHOOK_DOMAIN,
		path: process.env.WEBHOOK_PATH,
		port: config.server.port,
	};
}

if (process.env.DATABASE_URL) {
	config.database = {
		url: process.env.DATABASE_URL,
	};
}

if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
	config.voltagent.memory = {
		supabaseUrl: process.env.SUPABASE_URL,
		supabaseKey: process.env.SUPABASE_KEY,
		tableName: process.env.SUPABASE_MEMORY_TABLE_NAME || "voltagent_memory",
		storageLimit: parseInt(process.env.SUPABASE_MEMORY_STORAGE_LIMIT || "100", 10),
		debug: process.env.SUPABASE_MEMORY_DEBUG === "true",
	};
}

export function validateConfig(): void {
	const errors: string[] = [];

	if (!config.bot.token) {
		errors.push("BOT_TOKEN is required");
	}

	if (config.bot.webhook) {
		if (!config.bot.webhook.domain.startsWith("https://")) {
			errors.push("WEBHOOK_DOMAIN must start with https://");
		}
		if (!config.bot.webhook.path.startsWith("/")) {
			errors.push("WEBHOOK_PATH must start with /");
		}
	}

	if (config.voltagent.enabled) {
		if (!config.voltagent.llm.apiKey) {
			errors.push("LLM_API_KEY is required when Voltagent is enabled");
		}
		if (!["openai", "anthropic", "google"].includes(config.voltagent.llm.provider)) {
			errors.push("LLM_PROVIDER must be one of: openai, anthropic, google");
		}
		if (config.voltagent.memory) {
			if (!config.voltagent.memory.supabaseUrl) {
				errors.push("SUPABASE_URL is required when memory is configured");
			}
			if (!config.voltagent.memory.supabaseKey) {
				errors.push("SUPABASE_KEY is required when memory is configured");
			}
		}
	}

	// Validate database URL if provided
	if (config.database?.url) {
		if (!config.database.url.startsWith("postgresql://")) {
			errors.push("DATABASE_URL must be a valid PostgreSQL connection string");
		}
	}

	if (errors.length > 0) {
		throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
	}
}

export default config;
