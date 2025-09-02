import type TelegramBot from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import config from "../config/config";
// AgentBridgeService no longer needed for callbacks in knowledge-focused interface
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("CallbackHandler");

interface CallbackHandler {
	pattern: RegExp | string;
	handler: (bot: TelegramBot, query: TelegramBot.CallbackQuery) => Promise<void>;
}

const callbackHandlers: CallbackHandler[] = [];

export function setupCallbackHandlers(bot: TelegramBot, _sessionManager: SessionManager): void {
	registerDefaultCallbacks();

	bot.on("callback_query", async (query) => {
		const data = query.data;
		if (!data) return;

		logger.info(`Callback query received`, {
			userId: query.from.id,
			data,
		});

		let handled = false;

		for (const { pattern, handler } of callbackHandlers) {
			const matches = typeof pattern === "string" ? data === pattern : pattern.test(data);

			if (matches) {
				try {
					await handler(bot, query);
					handled = true;
					break;
				} catch (error) {
					logger.error(`Error handling callback ${data}`, error);
					await bot.answerCallbackQuery(query.id, {
						text: "❌ An error occurred",
						show_alert: true,
					});
				}
			}
		}

		if (!handled) {
			await handleUnknownCallback(bot, query);
		}
	});
}

function registerCallback(
	pattern: RegExp | string,
	handler: (bot: TelegramBot, query: TelegramBot.CallbackQuery) => Promise<void>
): void {
	callbackHandlers.push({ pattern, handler });
}

function registerDefaultCallbacks(): void {
	registerCallback("help", handleHelpCallback);
	registerCallback("settings", handleSettingsCallback);
	registerCallback("info", handleInfoCallback);
	registerCallback(/^settings_/, handleSettingsSubCallback);
	registerCallback("admin_panel", handleAdminPanelCallback);
	registerCallback(/^admin_/, handleAdminCallback);
	registerCallback(/^page_/, handlePaginationCallback);
	registerCallback("back", handleBackCallback);
	registerCallback("close", handleCloseCallback);

	// Knowledge-focused callbacks can be added here if needed
}

async function handleHelpCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const knowledgeCommands = config.voltagent.enabled
		? `
/search <query> - Explicit knowledge base search
/clear - Clear conversation history`
		: "";

	const helpText = `
*Available Commands:*

/start - Start the bot and see introduction
/help - Show help message
/info - Get bot information
/settings - Configure settings
/ping - Check bot status${knowledgeCommands}

*How to Use:*
Just send me any question and I'll search my knowledge base for answers!

*Need more help?*
Contact the administrator.
  `.trim();

	await bot.editMessageText(helpText, {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		parse_mode: "Markdown",
		reply_markup: {
			inline_keyboard: [
				[{ text: "⬅️ Back", callback_data: "back" }],
				[{ text: "❌ Close", callback_data: "close" }],
			],
		},
	});

	await bot.answerCallbackQuery(query.id);
}

async function handleSettingsCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const keyboard: TelegramBot.InlineKeyboardMarkup = {
		inline_keyboard: [
			[
				{ text: "🔔 Notifications", callback_data: "settings_notifications" },
				{ text: "🌐 Language", callback_data: "settings_language" },
			],
			[
				{ text: "🎨 Theme", callback_data: "settings_theme" },
				{ text: "🔐 Privacy", callback_data: "settings_privacy" },
			],
			[
				{ text: "⬅️ Back", callback_data: "back" },
				{ text: "❌ Close", callback_data: "close" },
			],
		],
	};

	await bot.editMessageText("⚙️ *Settings Menu*\n\nChoose a category to configure:", {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		parse_mode: "Markdown",
		reply_markup: keyboard,
	});

	await bot.answerCallbackQuery(query.id);
}

async function handleInfoCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const uptimeSeconds = process.uptime();
	const hours = Math.floor(uptimeSeconds / 3600);
	const minutes = Math.floor((uptimeSeconds % 3600) / 60);

	const infoText = `
*Bot Information:*

📊 Status: Online ✅
⏱ Uptime: ${hours}h ${minutes}m
🤖 Version: 1.0.0
📅 Date: ${new Date().toLocaleDateString()}

*Your Info:*
👤 User ID: \`${query.from.id}\`
💬 Chat ID: \`${query.message?.chat.id}\`
  `.trim();

	await bot.editMessageText(infoText, {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		parse_mode: "Markdown",
		reply_markup: {
			inline_keyboard: [
				[{ text: "⬅️ Back", callback_data: "back" }],
				[{ text: "❌ Close", callback_data: "close" }],
			],
		},
	});

	await bot.answerCallbackQuery(query.id);
}

async function handleSettingsSubCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const setting = query.data?.replace("settings_", "") || "";

	const settingsText: Record<string, string> = {
		notifications:
			"🔔 *Notification Settings*\n\nConfigure when and how you receive notifications.",
		language: "🌐 *Language Settings*\n\nSelect your preferred language.",
		theme: "🎨 *Theme Settings*\n\nChoose your preferred theme.",
		privacy: "🔐 *Privacy Settings*\n\nManage your privacy preferences.",
	};

	const text = settingsText[setting] || "Settings not found";

	await bot.editMessageText(text, {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		parse_mode: "Markdown",
		reply_markup: {
			inline_keyboard: [
				[{ text: "⬅️ Back to Settings", callback_data: "settings" }],
				[{ text: "❌ Close", callback_data: "close" }],
			],
		},
	});

	await bot.answerCallbackQuery(query.id, {
		text: `Opening ${setting} settings...`,
	});
}

async function handleAdminPanelCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const authContext = (query as any).authContext;

	if (!authContext?.isAdmin) {
		await bot.answerCallbackQuery(query.id, {
			text: "⛔ Admin access required",
			show_alert: true,
		});
		return;
	}

	const keyboard: TelegramBot.InlineKeyboardMarkup = {
		inline_keyboard: [
			[
				{ text: "📊 Statistics", callback_data: "admin_stats" },
				{ text: "👥 Users", callback_data: "admin_users" },
			],
			[
				{ text: "📝 Logs", callback_data: "admin_logs" },
				{ text: "⚠️ Errors", callback_data: "admin_errors" },
			],
			[
				{ text: "🔧 System", callback_data: "admin_system" },
				{ text: "📢 Broadcast", callback_data: "admin_broadcast" },
			],
			[
				{ text: "⬅️ Back", callback_data: "back" },
				{ text: "❌ Close", callback_data: "close" },
			],
		],
	};

	await bot.editMessageText("👑 *Admin Panel*\n\nSelect an admin function:", {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		parse_mode: "Markdown",
		reply_markup: keyboard,
	});

	await bot.answerCallbackQuery(query.id);
}

async function handleAdminCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const authContext = (query as any).authContext;

	if (!authContext?.isAdmin) {
		await bot.answerCallbackQuery(query.id, {
			text: "⛔ Admin access required",
			show_alert: true,
		});
		return;
	}

	const action = query.data?.replace("admin_", "");

	await bot.answerCallbackQuery(query.id, {
		text: `Loading ${action}...`,
	});

	await bot.editMessageText(`Admin function: ${action}\n\nThis feature is under development.`, {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		reply_markup: {
			inline_keyboard: [
				[{ text: "⬅️ Back to Admin", callback_data: "admin_panel" }],
				[{ text: "❌ Close", callback_data: "close" }],
			],
		},
	});
}

async function handlePaginationCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const page = parseInt(query.data?.replace("page_", "") || "0", 10);

	await bot.answerCallbackQuery(query.id, {
		text: `Loading page ${page}...`,
	});
}

async function handleBackCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const startKeyboard: TelegramBot.InlineKeyboardMarkup = {
		inline_keyboard: [
			[
				{ text: "📚 Help", callback_data: "help" },
				{ text: "⚙️ Settings", callback_data: "settings" },
			],
			[{ text: "ℹ️ Info", callback_data: "info" }],
		],
	};

	await bot.editMessageText("How can I help you today?", {
		chat_id: query.message?.chat.id,
		message_id: query.message?.message_id,
		reply_markup: startKeyboard,
	});

	await bot.answerCallbackQuery(query.id);
}

async function handleCloseCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	if (query.message) {
		await bot.deleteMessage(query.message.chat.id, query.message.message_id);
	}
	await bot.answerCallbackQuery(query.id, {
		text: "Menu closed",
	});
}

// Agent callback handler removed - using direct knowledge processing instead

async function handleUnknownCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	logger.warn(`Unknown callback data: ${query.data}`);

	await bot.answerCallbackQuery(query.id, {
		text: "❌ Unknown action",
		show_alert: true,
	});
}

export function registerCustomCallback(
	pattern: RegExp | string,
	handler: (bot: TelegramBot, query: TelegramBot.CallbackQuery) => Promise<void>
): void {
	registerCallback(pattern, handler);
}
