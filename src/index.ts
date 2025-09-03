import { BotInstance } from "./bot/bot";
import config, { validateConfig } from "./config/config";
import { createServer } from "./server/app";
import { StatusIndicatorService } from "./services/status-indicator.service";
import { VoltagentService } from "./services/voltagent.service";
import { BotLogger } from "./utils/logger";

const logger = new BotLogger("Main");

async function startBot(): Promise<void> {
	try {
		validateConfig();
		logger.info("Configuration validated successfully");

		if (config.voltagent.enabled) {
			logger.info("Initializing Voltagent service...");
			const voltagentService = VoltagentService.getInstance();
			await voltagentService.initialize();
			logger.info("Voltagent service initialized");
		}

		const bot = BotInstance.getInstance();

		// Initialize status indicator cleanup
		const statusService = StatusIndicatorService.getInstance();
		const cleanupInterval = setInterval(() => {
			statusService.cleanup();
		}, 60000); // Clean up every minute

		// Store cleanup interval for graceful shutdown
		(global as any).statusCleanupInterval = cleanupInterval;

		if (config.bot.webhook) {
			logger.info("Starting bot in webhook mode");
			const app = createServer(bot.getBot());

			await bot.setWebhook(`${config.bot.webhook.domain}${config.bot.webhook.path}`, {
				allowed_updates: ["message", "callback_query", "inline_query"],
			});

			Bun.serve({
				port: config.server.port,
				fetch: app.fetch,
			});

			logger.info(`Webhook server listening on port ${config.server.port}`);
		} else {
			logger.info("Starting bot in polling mode");
			await bot.start();
		}

		logger.info("Bot started successfully");
	} catch (error) {
		logger.error("Failed to start bot", error);
		process.exit(1);
	}
}

async function gracefulShutdown(signal: string): Promise<void> {
	logger.info(`Received ${signal}, shutting down gracefully...`);

	try {
		// Clean up status service interval
		const cleanupInterval = (global as any).statusCleanupInterval;
		if (cleanupInterval) {
			clearInterval(cleanupInterval);
			logger.info("Status cleanup interval cleared");
		}

		const bot = BotInstance.getInstance();

		if (config.bot.webhook) {
			await bot.deleteWebhook();
		} else {
			await bot.stop();
		}

		if (config.voltagent.enabled) {
			logger.info("Shutting down Voltagent service...");
			const voltagentService = VoltagentService.getInstance();
			await voltagentService.shutdown();
			logger.info("Voltagent service shutdown complete");
		}

		logger.info("Bot stopped successfully");
		process.exit(0);
	} catch (error) {
		logger.error("Error during shutdown", error);
		process.exit(1);
	}
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	logger.error("Unhandled rejection", { reason, promise });
	process.exit(1);
});

startBot();
