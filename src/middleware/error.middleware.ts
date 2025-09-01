import type TelegramBot from "node-telegram-bot-api";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("ErrorMiddleware");

export interface ErrorContext {
	userId?: number;
	chatId?: number;
	command?: string;
	messageText?: string;
	error: Error;
	timestamp: Date;
}

class ErrorHandler {
	private errorHistory: ErrorContext[] = [];
	private readonly MAX_HISTORY = 100;

	public async handleError(
		error: Error,
		msg?: TelegramBot.Message | TelegramBot.CallbackQuery,
		bot?: TelegramBot
	): Promise<void> {
		const errorContext: ErrorContext = {
			userId: msg?.from?.id,
			chatId:
				msg && "chat" in msg
					? msg.chat.id
					: msg && "message" in msg
						? msg.message?.chat.id
						: undefined,
			command: msg && "text" in msg ? this.extractCommand(msg.text) : undefined,
			messageText: msg && "text" in msg ? msg.text : undefined,
			error,
			timestamp: new Date(),
		};

		this.recordError(errorContext);
		logger.error("Bot error occurred", error);

		if (bot && errorContext.chatId) {
			await this.sendErrorMessage(bot, errorContext.chatId, error);
		}
	}

	private extractCommand(text?: string): string | undefined {
		if (!text) return undefined;
		const match = text.match(/^\/(\w+)/);
		return match ? match[1] : undefined;
	}

	private recordError(context: ErrorContext): void {
		this.errorHistory.push(context);

		if (this.errorHistory.length > this.MAX_HISTORY) {
			this.errorHistory.shift();
		}
	}

	private async sendErrorMessage(bot: TelegramBot, chatId: number, error: Error): Promise<void> {
		try {
			const isProduction = process.env.NODE_ENV === "production";

			const message = isProduction
				? "❌ An error occurred while processing your request. Please try again later."
				: `❌ Error: ${error.message}\n\nPlease try again or contact support if the issue persists.`;

			await bot.sendMessage(chatId, message);
		} catch (sendError) {
			logger.error("Failed to send error message", sendError);
		}
	}

	public getErrorHistory(): ErrorContext[] {
		return [...this.errorHistory];
	}

	public clearErrorHistory(): void {
		this.errorHistory = [];
	}

	public getErrorStats(): {
		total: number;
		last24Hours: number;
		lastHour: number;
		topErrors: { message: string; count: number }[];
	} {
		const now = Date.now();
		const hourAgo = now - 60 * 60 * 1000;
		const dayAgo = now - 24 * 60 * 60 * 1000;

		const errorCounts = new Map<string, number>();
		let last24Hours = 0;
		let lastHour = 0;

		for (const context of this.errorHistory) {
			const time = context.timestamp.getTime();

			if (time > dayAgo) {
				last24Hours++;
			}

			if (time > hourAgo) {
				lastHour++;
			}

			const errorMessage = context.error.message;
			errorCounts.set(errorMessage, (errorCounts.get(errorMessage) || 0) + 1);
		}

		const topErrors = Array.from(errorCounts.entries())
			.map(([message, count]) => ({ message, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		return {
			total: this.errorHistory.length,
			last24Hours,
			lastHour,
			topErrors,
		};
	}
}

const errorHandler = new ErrorHandler();

export function createErrorMiddleware() {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		try {
			await next();
		} catch (error) {
			const bot = (msg as any).bot as TelegramBot;
			await errorHandler.handleError(error as Error, msg, bot);
		}
	};
}

export function wrapAsyncHandler<T extends any[]>(
	handler: (...args: T) => Promise<void>
): (...args: T) => void {
	return (...args: T) => {
		handler(...args).catch((error) => {
			logger.error("Unhandled async error", error);
		});
	};
}

export function getErrorHandler(): ErrorHandler {
	return errorHandler;
}

export { ErrorHandler };
