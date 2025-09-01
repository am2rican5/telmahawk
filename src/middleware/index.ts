import type TelegramBot from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import { createAuthMiddleware } from "./auth.middleware";
import { createErrorMiddleware } from "./error.middleware";
import { createLoggingMiddleware } from "./logging.middleware";
import { createRateLimitMiddleware } from "./rateLimit.middleware";

export type MiddlewareFunction = (
	msg: TelegramBot.Message | TelegramBot.CallbackQuery,
	next: () => Promise<void>
) => Promise<void>;

export class MiddlewareChain {
	private middlewares: MiddlewareFunction[] = [];

	public use(middleware: MiddlewareFunction): void {
		this.middlewares.push(middleware);
	}

	public async execute(msg: TelegramBot.Message | TelegramBot.CallbackQuery): Promise<void> {
		let index = 0;

		const next = async (): Promise<void> => {
			if (index >= this.middlewares.length) {
				return;
			}

			const middleware = this.middlewares[index++];
			await middleware(msg, next);
		};

		await next();
	}
}

export function applyMiddleware(bot: TelegramBot, sessionManager: SessionManager): void {
	const messageChain = new MiddlewareChain();
	const callbackChain = new MiddlewareChain();

	messageChain.use(createLoggingMiddleware());
	messageChain.use(createErrorMiddleware());
	messageChain.use(createAuthMiddleware(sessionManager));
	messageChain.use(createRateLimitMiddleware());

	callbackChain.use(createLoggingMiddleware());
	callbackChain.use(createErrorMiddleware());
	callbackChain.use(createAuthMiddleware(sessionManager));
	callbackChain.use(createRateLimitMiddleware());

	const originalOnMessage = bot.on.bind(bot);
	const originalOnCallbackQuery = bot.on.bind(bot);

	(bot as any).messageHandlers = [];
	(bot as any).callbackHandlers = [];

	bot.on = (event: any, listener: any) => {
		if (event === "message") {
			(bot as any).messageHandlers.push(listener);
			return bot;
		} else if (event === "callback_query") {
			(bot as any).callbackHandlers.push(listener);
			return bot;
		}
		return originalOnMessage(event, listener);
	};

	originalOnMessage("message", async (msg: TelegramBot.Message) => {
		(msg as any).bot = bot;

		await messageChain.execute(msg);

		for (const handler of (bot as any).messageHandlers) {
			await handler(msg);
		}
	});

	originalOnCallbackQuery("callback_query", async (query: TelegramBot.CallbackQuery) => {
		(query as any).bot = bot;

		await callbackChain.execute(query);

		for (const handler of (bot as any).callbackHandlers) {
			await handler(query);
		}
	});
}

export * from "./auth.middleware";
export * from "./error.middleware";
export * from "./logging.middleware";
export * from "./rateLimit.middleware";
