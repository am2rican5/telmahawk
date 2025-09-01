import type TelegramBot from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import config from "../config/config";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("AuthMiddleware");

export interface AuthContext {
	userId: number;
	chatId: number;
	username?: string;
	isAdmin: boolean;
	isBlocked: boolean;
}

export function createAuthMiddleware(sessionManager: SessionManager) {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		try {
			const userId = msg.from?.id;
			const chatId = "chat" in msg ? msg.chat.id : msg.message?.chat.id;

			if (!userId || !chatId) {
				logger.warn("Message without user or chat ID", { msg });
				return;
			}

			let session = sessionManager.getSession(userId);

			if (!session) {
				session = sessionManager.createSession(userId, {
					username: msg.from?.username,
					firstName: msg.from?.first_name,
					lastName: msg.from?.last_name,
					languageCode: msg.from?.language_code,
				});
			}

			if (session.isBlocked) {
				logger.warn(`Blocked user ${userId} attempted to use bot`);
				return;
			}

			const authContext: AuthContext = {
				userId,
				chatId: chatId as number,
				username: msg.from?.username,
				isAdmin: config.admin.userIds.includes(userId),
				isBlocked: session.isBlocked,
			};

			(msg as any).authContext = authContext;
			(msg as any).session = session;

			await next();
		} catch (error) {
			logger.error("Auth middleware error", error);
		}
	};
}

export function requireAdmin() {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		const authContext = (msg as any).authContext as AuthContext;

		if (!authContext?.isAdmin) {
			logger.warn(`Non-admin user ${authContext?.userId} tried to access admin function`);

			const bot = (msg as any).bot as TelegramBot;
			const chatId = "chat" in msg ? msg.chat.id : msg.message?.chat.id;

			if (bot && chatId) {
				await bot.sendMessage(chatId, "⛔ This command is restricted to administrators only.");
			}
			return;
		}

		await next();
	};
}

export function requirePrivateChat() {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		const chat = "chat" in msg ? msg.chat : msg.message?.chat;

		if (!chat || chat.type !== "private") {
			const bot = (msg as any).bot as TelegramBot;

			if (bot && chat) {
				await bot.sendMessage(chat.id, "🔒 This command can only be used in private chat.");
			}
			return;
		}

		await next();
	};
}

export function requireGroupChat() {
	return async (
		msg: TelegramBot.Message | TelegramBot.CallbackQuery,
		next: () => Promise<void>
	): Promise<void> => {
		const chat = "chat" in msg ? msg.chat : msg.message?.chat;

		if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
			const bot = (msg as any).bot as TelegramBot;

			if (bot && chat) {
				await bot.sendMessage(chat.id, "👥 This command can only be used in group chats.");
			}
			return;
		}

		await next();
	};
}
