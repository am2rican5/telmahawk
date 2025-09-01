import type TelegramBot from "node-telegram-bot-api";
import type { InlineKeyboardMarkup, Message } from "node-telegram-bot-api";
import config from "../config/config";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("CommandHandler");

export interface CommandContext {
	bot: TelegramBot;
	msg: Message;
	match: RegExpMatchArray | null;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void> | void;

export class CommandRegistry {
	private commands: Map<string, CommandHandler> = new Map();
	private bot: TelegramBot;

	constructor(bot: TelegramBot) {
		this.bot = bot;
		this.registerDefaultCommands();
	}

	private registerDefaultCommands(): void {
		this.register("start", this.handleStart);
		this.register("help", this.handleHelp);
		this.register("info", this.handleInfo);
		this.register("settings", this.handleSettings);
		this.register("ping", this.handlePing);
	}

	register(command: string, handler: CommandHandler): void {
		this.commands.set(command, handler);
		logger.info(`Command registered: /${command}`);
	}

	async execute(command: string, msg: Message, match: RegExpMatchArray | null): Promise<void> {
		const handler = this.commands.get(command);
		if (!handler) {
			logger.warn(`Unknown command: /${command}`, { userId: msg.from?.id });
			await this.bot.sendMessage(
				msg.chat.id,
				`Unknown command: /${command}. Type /help for available commands.`
			);
			return;
		}

		try {
			logger.info(`Executing command: /${command}`, {
				userId: msg.from?.id,
				chatId: msg.chat.id,
			});
			await handler({ bot: this.bot, msg, match });
		} catch (error) {
			logger.error(`Error executing command /${command}`, error);
			await this.bot.sendMessage(
				msg.chat.id,
				"An error occurred while processing your command. Please try again later."
			);
		}
	}

	private handleStart: CommandHandler = async ({ bot, msg }) => {
		const userName = msg.from?.first_name || "User";
		const welcomeMessage = `
Welcome ${userName}! 🚀

I'm your Telegram Bot built with TypeScript.

Here's what I can do:
• Process your messages
• Handle commands
• Send inline keyboards
• And much more!

Type /help to see all available commands.
    `.trim();

		const keyboard: InlineKeyboardMarkup = {
			inline_keyboard: [
				[
					{ text: "📚 Help", callback_data: "help" },
					{ text: "⚙️ Settings", callback_data: "settings" },
				],
				[{ text: "ℹ️ Info", callback_data: "info" }],
			],
		};

		await bot.sendMessage(msg.chat.id, welcomeMessage, {
			reply_markup: keyboard,
			parse_mode: "Markdown",
		});
	};

	private handleHelp: CommandHandler = async ({ bot, msg }) => {
		const helpMessage = `
*Available Commands:*

/start - Start the bot
/help - Show this help message
/info - Get bot information
/settings - Configure bot settings
/ping - Check if bot is responsive

*Features:*
• Text message processing
• Inline keyboards
• Callback queries
• Rate limiting
• Admin commands

*Need assistance?*
Contact the bot administrator.
    `.trim();

		await bot.sendMessage(msg.chat.id, helpMessage, {
			parse_mode: "Markdown",
		});
	};

	private handleInfo: CommandHandler = async ({ bot, msg }) => {
		const uptimeSeconds = process.uptime();
		const hours = Math.floor(uptimeSeconds / 3600);
		const minutes = Math.floor((uptimeSeconds % 3600) / 60);
		const seconds = Math.floor(uptimeSeconds % 60);

		const infoMessage = `
*Bot Information:*

📊 *Status:* Online ✅
⏱ *Uptime:* ${hours}h ${minutes}m ${seconds}s
🌍 *Environment:* ${config.server.environment}
👤 *Your ID:* \`${msg.from?.id}\`
💬 *Chat ID:* \`${msg.chat.id}\`
🤖 *Bot Version:* 1.0.0

*System Info:*
• Node.js: ${process.version}
• Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
    `.trim();

		await bot.sendMessage(msg.chat.id, infoMessage, {
			parse_mode: "Markdown",
		});
	};

	private handleSettings: CommandHandler = async ({ bot, msg }) => {
		const isAdmin = config.admin.userIds.includes(msg.from?.id || 0);

		const keyboard: InlineKeyboardMarkup = {
			inline_keyboard: [
				[
					{ text: "🔔 Notifications", callback_data: "settings_notifications" },
					{ text: "🌐 Language", callback_data: "settings_language" },
				],
				[{ text: "🎨 Theme", callback_data: "settings_theme" }],
			],
		};

		if (isAdmin) {
			keyboard.inline_keyboard.push([{ text: "👑 Admin Panel", callback_data: "admin_panel" }]);
		}

		await bot.sendMessage(msg.chat.id, "Choose a setting to configure:", {
			reply_markup: keyboard,
		});
	};

	private handlePing: CommandHandler = async ({ bot, msg }) => {
		const start = Date.now();
		const sentMsg = await bot.sendMessage(msg.chat.id, "Pong! 🏓");
		const latency = Date.now() - start;

		await bot.editMessageText(`Pong! 🏓\nLatency: ${latency}ms`, {
			chat_id: msg.chat.id,
			message_id: sentMsg.message_id,
		});
	};

	getCommands(): string[] {
		return Array.from(this.commands.keys());
	}
}

export function setupCommands(bot: TelegramBot): CommandRegistry {
	const registry = new CommandRegistry(bot);

	bot.onText(/^\/(\w+)(.*)/, async (msg, match) => {
		const command = match?.[1];
		if (command) {
			await registry.execute(command, msg, match);
		}
	});

	return registry;
}
