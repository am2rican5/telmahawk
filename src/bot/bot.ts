import TelegramBot from "node-telegram-bot-api";
import config from "../config/config";
import { setupCallbackHandlers } from "../handlers/callback.handler";
import { setupCommands } from "../handlers/commands";
import { setupInlineHandlers } from "../handlers/inline.handler";
import { setupMessageHandlers } from "../handlers/message.handler";
import { applyMiddleware } from "../middleware";
import { BotLogger } from "../utils/logger";
import { SessionManager } from "./session";

const logger = new BotLogger("BotCore");

export class BotInstance {
	private static instance: BotInstance;
	private bot: TelegramBot;
	private sessionManager: SessionManager;
	private isRunning: boolean = false;

	private constructor() {
		const options: TelegramBot.ConstructorOptions = config.bot.webhook
			? { webHook: true }
			: { polling: config.bot.polling };

		this.bot = new TelegramBot(config.bot.token, options);
		this.sessionManager = new SessionManager();
		this.setupHandlers();
		this.setupErrorHandling();
	}

	public static getInstance(): BotInstance {
		if (!BotInstance.instance) {
			BotInstance.instance = new BotInstance();
		}
		return BotInstance.instance;
	}

	private setupHandlers(): void {
		applyMiddleware(this.bot, this.sessionManager);

		setupCommands(this.bot);
		setupMessageHandlers(this.bot, this.sessionManager);
		setupCallbackHandlers(this.bot, this.sessionManager);
		setupInlineHandlers(this.bot);

		logger.info("Bot handlers initialized");
	}

	private setupErrorHandling(): void {
		this.bot.on("polling_error", async (error) => {
			logger.error("Polling error", error);
			
			if (error.message.includes("409") && error.message.includes("getUpdates")) {
				logger.warn("Detected 409 conflict error. Attempting to recover...");
				
				try {
					await this.bot.stopPolling();
					this.isRunning = false;
					
					await new Promise(resolve => setTimeout(resolve, 2000));
					
					await this.bot.deleteWebHook();
					
					await new Promise(resolve => setTimeout(resolve, 1000));
					
					await this.bot.startPolling();
					this.isRunning = true;
					
					logger.info("Successfully recovered from polling conflict");
				} catch (recoveryError) {
					logger.error("Failed to recover from polling conflict", recoveryError);
				}
			}
		});

		this.bot.on("webhook_error", (error) => {
			logger.error("Webhook error", error);
		});

		this.bot.on("error", (error) => {
			logger.error("Bot error", error);
		});
	}

	public getBot(): TelegramBot {
		return this.bot;
	}

	public getSessionManager(): SessionManager {
		return this.sessionManager;
	}

	public async start(): Promise<void> {
		if (this.isRunning) {
			logger.warn("Bot is already running");
			return;
		}

		if (!config.bot.webhook) {
			try {
				await this.bot.deleteWebHook();
				logger.info("Cleared any existing webhook before starting polling");
			} catch (error) {
				logger.debug("No webhook to clear or error clearing webhook", error);
			}

			await new Promise(resolve => setTimeout(resolve, 1000));

			await this.bot.startPolling();
			this.isRunning = true;
			logger.info("Bot started in polling mode");
		}
	}

	public async stop(): Promise<void> {
		if (!this.isRunning && !config.bot.webhook) {
			logger.warn("Bot is not running");
			return;
		}

		if (!config.bot.webhook) {
			await this.bot.stopPolling();
			this.isRunning = false;
			logger.info("Bot stopped");
		}
	}

	public async setWebhook(url: string, options?: TelegramBot.SetWebHookOptions): Promise<void> {
		await this.bot.setWebHook(url, options);
		this.isRunning = true;
		logger.info(`Webhook set to ${url}`);
	}

	public async deleteWebhook(): Promise<void> {
		await this.bot.deleteWebHook();
		this.isRunning = false;
		logger.info("Webhook deleted");
	}

	public async sendMessage(
		chatId: number | string,
		text: string,
		options?: TelegramBot.SendMessageOptions
	): Promise<TelegramBot.Message> {
		return this.bot.sendMessage(chatId, text, options);
	}

	public async sendPhoto(
		chatId: number | string,
		photo: string | Buffer,
		options?: TelegramBot.SendPhotoOptions
	): Promise<TelegramBot.Message> {
		return this.bot.sendPhoto(chatId, photo, options);
	}

	public async sendDocument(
		chatId: number | string,
		document: string | Buffer,
		options?: TelegramBot.SendDocumentOptions
	): Promise<TelegramBot.Message> {
		return this.bot.sendDocument(chatId, document, options);
	}

	public async answerCallbackQuery(
		callbackQueryId: string,
		options?: TelegramBot.AnswerCallbackQueryOptions
	): Promise<boolean> {
		return this.bot.answerCallbackQuery(callbackQueryId, options);
	}

	public async editMessageText(
		text: string,
		options: TelegramBot.EditMessageTextOptions
	): Promise<TelegramBot.Message | boolean> {
		return this.bot.editMessageText(text, options);
	}

	public async getChatMember(
		chatId: number | string,
		userId: number
	): Promise<TelegramBot.ChatMember> {
		return this.bot.getChatMember(chatId, userId);
	}

	public isAdmin(userId: number): boolean {
		return config.admin.userIds.includes(userId);
	}
}
