import type TelegramBot from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import config from "../config/config";
import { AgentBridgeService } from "../services/agent-bridge.service";
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

	if (config.voltagent.enabled) {
		registerCallback(/^start_agent_/, handleStartAgentCallback);
	}
}

async function handleHelpCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const helpText = `
*Available Commands:*

/start - Start the bot
/help - Show help message
/info - Get bot information
/settings - Configure settings
/ping - Check bot status

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

async function handleStartAgentCallback(
	bot: TelegramBot,
	query: TelegramBot.CallbackQuery
): Promise<void> {
	const userId = query.from.id.toString();
	const agentType = query.data?.replace("start_agent_", "");

	if (!agentType) {
		await bot.answerCallbackQuery(query.id, {
			text: "❌ Invalid agent type",
			show_alert: true,
		});
		return;
	}

	const agentBridge = AgentBridgeService.getInstance();

	try {
		const startedAgentType = await agentBridge.startAgentSession(userId, agentType);

		// Escape all problematic characters that could break Telegram Markdown parsing
		const safeAgentType = startedAgentType.replace(/[*_`[\]()~>#+=|{}.!-]/g, "\\$&");

		await bot.editMessageText(
			`🤖 Started conversation with *${safeAgentType}* agent!\n\nYou can now send me messages and I'll respond as your AI assistant. Use /agent\\_stop to end the conversation.`,
			{
				chat_id: query.message?.chat.id,
				message_id: query.message?.message_id,
				parse_mode: "Markdown",
				reply_markup: {
					inline_keyboard: [
						[{ text: "❌ Stop Agent", callback_data: "agent_stop" }],
						[{ text: "ℹ️ Agent Info", callback_data: `agent_info_${agentType}` }],
					],
				},
			}
		);

		await bot.answerCallbackQuery(query.id, {
			text: `🤖 ${startedAgentType} agent started!`,
		});
	} catch (error) {
		logger.error("Error starting agent from callback", error);
		await bot.answerCallbackQuery(query.id, {
			text: error instanceof Error ? error.message : "Failed to start agent",
			show_alert: true,
		});
	}
}

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
