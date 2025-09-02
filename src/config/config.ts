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

	if (errors.length > 0) {
		throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
	}
}

export default config;
