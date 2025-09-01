import type TelegramBot from "node-telegram-bot-api";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("LoggingMiddleware");

export interface LogEntry {
	timestamp: Date;
	userId?: number;
	username?: string;
	chatId?: number;
	chatType?: string;
	messageType: string;
	content?: string;
	command?: string;
	callbackData?: string;
	responseTime?: number;
}

class RequestLogger {
	private logs: LogEntry[] = [];
	private readonly MAX_LOGS = 1000;

	public logRequest(entry: LogEntry): void {
		this.logs.push(entry);

		if (this.logs.length > this.MAX_LOGS) {
			this.logs.shift();
		}

		const logMessage = this.formatLogMessage(entry);
		logger.info(logMessage, {
			userId: entry.userId,
			chatId: entry.chatId,
			type: entry.messageType,
		});
	}

	private formatLogMessage(entry: LogEntry): string {
		const parts = [`${entry.messageType} from user ${entry.userId}`];

		if (entry.username) {
			parts.push(`(@${entry.username})`);
		}

		if (entry.command) {
			parts.push(`- Command: /${entry.command}`);
		} else if (entry.callbackData) {
			parts.push(`- Callback: ${entry.callbackData}`);
		} else if (entry.content) {
			const truncated =
				entry.content.length > 50 ? `${entry.content.substring(0, 50)}...` : entry.content;
			parts.push(`- Content: ${truncated}`);
		}

		if (entry.responseTime) {
			parts.push(`[${entry.responseTime}ms]`);
		}

		return parts.join(" ");
	}

	public getLogs(filters?: {
		userId?: number;
		chatId?: number;
		command?: string;
		limit?: number;
	}): LogEntry[] {
		let filtered = [...this.logs];

		if (filters?.userId) {
			filtered = filtered.filter((log) => log.userId === filters.userId);
		}

		if (filters?.chatId) {
			filtered = filtered.filter((log) => log.chatId === filters.chatId);
		}

		if (filters?.command) {
			filtered = filtered.filter((log) => log.command === filters.command);
		}

		if (filters?.limit) {
			filtered = filtered.slice(-filters.limit);
		}

		return filtered;
	}

	public getStats(): {
		totalRequests: number;
		uniqueUsers: number;
		commandUsage: Map<string, number>;
		averageResponseTime: number;
		requestsPerHour: number;
	} {
		const uniqueUsers = new Set(this.logs.map((log) => log.userId).filter(Boolean));
		const commandUsage = new Map<string, number>();
		let totalResponseTime = 0;
		let responseTimeCount = 0;

		const hourAgo = Date.now() - 60 * 60 * 1000;
		let recentRequests = 0;

		for (const log of this.logs) {
			if (log.command) {
				commandUsage.set(log.command, (commandUsage.get(log.command) || 0) + 1);
			}

			if (log.responseTime) {
				totalResponseTime += log.responseTime;
				responseTimeCount++;
			}

			if (log.timestamp.getTime() > hourAgo) {
				recentRequests++;
			}
		}

		return {
			totalRequests: this.logs.length,
			uniqueUsers: uniqueUsers.size,
			commandUsage,
			averageResponseTime: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
			requestsPerHour: recentRequests,
		};
	}

	public clearLogs(): void {
		this.logs = [];
		logger.info("Request logs cleared");
	}
}

const requestLogger = new RequestLogger();

export function createLoggingMiddleware() {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		const startTime = Date.now();

		const entry: LogEntry = {
			timestamp: new Date(),
			userId: msg.from?.id,
			username: msg.from?.username,
			chatId: "chat" in msg ? msg.chat.id : msg.message?.chat.id,
			chatType: "chat" in msg ? msg.chat.type : msg.message?.chat.type,
			messageType: "data" in msg ? "callback_query" : "message",
		};

		if ("text" in msg && msg.text) {
			const commandMatch = msg.text.match(/^\/(\w+)/);
			if (commandMatch) {
				entry.command = commandMatch[1];
			} else {
				entry.content = msg.text;
			}
		} else if ("data" in msg) {
			entry.callbackData = msg.data;
		}

		try {
			await next();
			entry.responseTime = Date.now() - startTime;
		} catch (error) {
			entry.responseTime = Date.now() - startTime;
			throw error;
		} finally {
			requestLogger.logRequest(entry);
		}
	};
}

export function getRequestLogger(): RequestLogger {
	return requestLogger;
}

export { RequestLogger };
