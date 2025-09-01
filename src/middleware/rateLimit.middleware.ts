import type TelegramBot from "node-telegram-bot-api";
import config from "../config/config";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("RateLimitMiddleware");

interface RateLimitEntry {
	count: number;
	firstRequest: number;
	lastRequest: number;
	warnings: number;
}

class RateLimiter {
	private limits: Map<number, RateLimitEntry> = new Map();
	private readonly windowMs: number;
	private readonly maxRequests: number;
	private readonly cleanupInterval: NodeJS.Timeout;

	constructor(windowMs: number = 60000, maxRequests: number = 30) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;

		this.cleanupInterval = setInterval(() => this.cleanup(), windowMs);
	}

	public isRateLimited(userId: number): boolean {
		const now = Date.now();
		const entry = this.limits.get(userId);

		if (!entry) {
			this.limits.set(userId, {
				count: 1,
				firstRequest: now,
				lastRequest: now,
				warnings: 0,
			});
			return false;
		}

		if (now - entry.firstRequest > this.windowMs) {
			entry.count = 1;
			entry.firstRequest = now;
			entry.lastRequest = now;
			return false;
		}

		entry.count++;
		entry.lastRequest = now;

		if (entry.count > this.maxRequests) {
			entry.warnings++;
			logger.warn(`User ${userId} exceeded rate limit`, {
				count: entry.count,
				warnings: entry.warnings,
				windowMs: this.windowMs,
			});
			return true;
		}

		return false;
	}

	public resetUser(userId: number): void {
		this.limits.delete(userId);
	}

	public getUserStats(userId: number): RateLimitEntry | undefined {
		return this.limits.get(userId);
	}

	private cleanup(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [userId, entry] of this.limits.entries()) {
			if (now - entry.lastRequest > this.windowMs * 2) {
				this.limits.delete(userId);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.debug(`Cleaned up ${cleaned} rate limit entries`);
		}
	}

	public destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.limits.clear();
	}
}

const rateLimiter = new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxRequests);

export function createRateLimitMiddleware() {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		const userId = msg.from?.id;

		if (!userId) {
			return;
		}

		const authContext = (msg as any).authContext;
		if (authContext?.isAdmin) {
			await next();
			return;
		}

		if (rateLimiter.isRateLimited(userId)) {
			const bot = (msg as any).bot as TelegramBot;
			const chatId = "chat" in msg ? msg.chat.id : msg.message?.chat.id;

			if (bot && chatId) {
				const stats = rateLimiter.getUserStats(userId);
				const remainingTime = Math.ceil(
					(config.rateLimit.windowMs - (Date.now() - (stats?.firstRequest || 0))) / 1000
				);

				await bot.sendMessage(
					chatId,
					`⏱ Rate limit exceeded. Please wait ${remainingTime} seconds before sending more messages.\n\n` +
						`Current limit: ${config.rateLimit.maxRequests} messages per ${config.rateLimit.windowMs / 1000} seconds.`
				);
			}
			return;
		}

		await next();
	};
}

export function getRateLimiter(): RateLimiter {
	return rateLimiter;
}

export { RateLimiter };
