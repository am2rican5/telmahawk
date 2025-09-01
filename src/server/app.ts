import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type TelegramBot from "node-telegram-bot-api";
import config from "../config/config";
import type { WebhookRequest } from "../types";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("ExpressServer");

export function createServer(bot: TelegramBot): Express {
	const app = express();

	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));

	app.use((req: Request, _res: Response, next: NextFunction) => {
		logger.debug(`${req.method} ${req.path}`, {
			ip: req.ip,
			userAgent: req.get("user-agent"),
		});
		next();
	});

	app.get("/health", (_req: Request, res: Response) => {
		const uptime = process.uptime();
		const memoryUsage = process.memoryUsage();

		res.json({
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

	app.get("/status", (_req: Request, res: Response) => {
		res.json({
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
		app.post(config.bot.webhook.path, async (req: Request, res: Response) => {
			try {
				const update = req.body as WebhookRequest;

				logger.debug("Webhook update received", {
					updateId: update.update_id,
					hasMessage: !!update.message,
					hasCallback: !!update.callback_query,
				});

				await bot.processUpdate(update as any);

				res.sendStatus(200);
			} catch (error) {
				logger.error("Webhook processing error", error);
				res.sendStatus(200);
			}
		});

		logger.info(`Webhook endpoint configured at ${config.bot.webhook.path}`);
	}

	app.get("/metrics", (_req: Request, res: Response) => {
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

		res.set("Content-Type", "text/plain");
		res.send(metrics);
	});

	app.use((req: Request, res: Response) => {
		res.status(404).json({
			error: "Not Found",
			message: "The requested endpoint does not exist",
			path: req.path,
		});
	});

	app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
		logger.error("Express error", err);

		res.status(500).json({
			error: "Internal Server Error",
			message:
				config.server.environment === "production"
					? "An error occurred processing your request"
					: err.message,
		});
	});

	return app;
}
