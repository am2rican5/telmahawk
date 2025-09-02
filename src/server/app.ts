import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger as honoLogger } from "hono/logger";
import type TelegramBot from "node-telegram-bot-api";
import config from "../config/config";
import type { WebhookRequest } from "../types";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("HonoServer");

export function createServer(bot: TelegramBot): Hono {
	const app = new Hono();

	app.use("*", honoLogger());

	app.use("*", async (c, next) => {
		logger.debug(`${c.req.method} ${c.req.path}`, {
			userAgent: c.req.header("user-agent"),
		});
		await next();
	});

	app.get("/health", (c) => {
		const uptime = process.uptime();
		const memoryUsage = process.memoryUsage();

		return c.json({
			status: "healthy",
			uptime: Math.floor(uptime),
			memory: {
				used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
				total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
			},
			environment: config.server.environment,
			timestamp: new Date().toISOString(),
		});
	});

	app.get("/status", (c) => {
		return c.json({
			bot: {
				running: true,
				mode: config.bot.webhook ? "webhook" : "polling",
			},
			server: {
				port: config.server.port,
				environment: config.server.environment,
			},
			version: "1.0.0",
		});
	});

	if (config.bot.webhook) {
		app.post(config.bot.webhook.path, async (c) => {
			try {
				const update = (await c.req.json()) as WebhookRequest;

				logger.debug("Webhook update received", {
					updateId: update.update_id,
					hasMessage: !!update.message,
					hasCallback: !!update.callback_query,
				});

				await bot.processUpdate(update as any);

				return c.body(null, 200);
			} catch (error) {
				logger.error("Webhook processing error", error);
				return c.body(null, 200);
			}
		});

		logger.info(`Webhook endpoint configured at ${config.bot.webhook.path}`);
	}

	app.get("/metrics", (c) => {
		const memoryUsage = process.memoryUsage();
		const cpuUsage = process.cpuUsage();

		const metrics = [
			`# HELP process_uptime_seconds Process uptime in seconds`,
			`# TYPE process_uptime_seconds gauge`,
			`process_uptime_seconds ${process.uptime()}`,
			``,
			`# HELP process_memory_heap_used_bytes Process heap memory used in bytes`,
			`# TYPE process_memory_heap_used_bytes gauge`,
			`process_memory_heap_used_bytes ${memoryUsage.heapUsed}`,
			``,
			`# HELP process_memory_heap_total_bytes Process heap memory total in bytes`,
			`# TYPE process_memory_heap_total_bytes gauge`,
			`process_memory_heap_total_bytes ${memoryUsage.heapTotal}`,
			``,
			`# HELP process_cpu_user_seconds_total Process CPU user time in seconds`,
			`# TYPE process_cpu_user_seconds_total counter`,
			`process_cpu_user_seconds_total ${cpuUsage.user / 1000000}`,
			``,
			`# HELP process_cpu_system_seconds_total Process CPU system time in seconds`,
			`# TYPE process_cpu_system_seconds_total counter`,
			`process_cpu_system_seconds_total ${cpuUsage.system / 1000000}`,
		].join("\n");

		c.header("Content-Type", "text/plain");
		return c.text(metrics);
	});

	app.notFound((c) => {
		return c.json(
			{
				error: "Not Found",
				message: "The requested endpoint does not exist",
				path: c.req.path,
			},
			404
		);
	});

	app.onError((err, c) => {
		logger.error("Hono error", err);

		if (err instanceof HTTPException) {
			return c.json({ error: err.message }, err.status);
		}

		return c.json(
			{
				error: "Internal Server Error",
				message:
					config.server.environment === "production"
						? "An error occurred processing your request"
						: err.message,
			},
			500
		);
	});

	return app;
}
