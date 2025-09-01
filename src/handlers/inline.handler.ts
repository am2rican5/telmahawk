import type TelegramBot from "node-telegram-bot-api";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("InlineHandler");

export function setupInlineHandlers(bot: TelegramBot): void {
	bot.on("inline_query", async (query) => {
		await handleInlineQuery(bot, query);
	});

	bot.on("chosen_inline_result", async (result) => {
		logger.info("Inline result chosen", {
			resultId: result.result_id,
			userId: result.from.id,
			query: result.query,
		});
	});
}

async function handleInlineQuery(bot: TelegramBot, query: TelegramBot.InlineQuery): Promise<void> {
	const searchQuery = query.query.toLowerCase();

	logger.info("Inline query received", {
		userId: query.from.id,
		query: searchQuery,
	});

	const results: TelegramBot.InlineQueryResult[] = [];

	if (!searchQuery) {
		results.push(
			createArticleResult(
				"help",
				"📚 Help",
				"Get help with using the bot",
				"Click here to see available commands:\n\n/start - Start the bot\n/help - Show help\n/info - Bot information"
			),
			createArticleResult(
				"about",
				"ℹ️ About",
				"Learn about this bot",
				"This is a powerful Telegram bot built with TypeScript!"
			),
			createArticleResult(
				"contact",
				"📧 Contact",
				"Contact the administrator",
				"For support, please contact the bot administrator."
			)
		);
	} else {
		if (searchQuery.includes("help")) {
			results.push(
				createArticleResult(
					"help_search",
					"📚 Help Documentation",
					"Complete help guide",
					generateHelpText()
				)
			);
		}

		if (searchQuery.includes("command")) {
			results.push(
				createArticleResult(
					"commands",
					"📝 Available Commands",
					"List of all bot commands",
					generateCommandsList()
				)
			);
		}

		if (searchQuery.includes("info") || searchQuery.includes("about")) {
			results.push(
				createArticleResult(
					"info",
					"ℹ️ Bot Information",
					"Detailed bot information",
					generateBotInfo()
				)
			);
		}

		results.push(
			createArticleResult(
				`search_${Date.now()}`,
				`🔍 Search: ${query.query}`,
				`Results for "${query.query}"`,
				`You searched for: "${query.query}"\n\nTry these commands:\n/help - Get help\n/info - Bot information`
			)
		);
	}

	if (results.length === 0) {
		results.push(
			createArticleResult(
				"no_results",
				"❌ No Results",
				"No results found",
				`No results found for "${query.query}"`
			)
		);
	}

	try {
		await bot.answerInlineQuery(query.id, results, {
			cache_time: 300,
			is_personal: true,
			switch_pm_text: "Go to bot",
			switch_pm_parameter: "inline_help",
		});
	} catch (error) {
		logger.error("Error answering inline query", error);
	}
}

function createArticleResult(
	id: string,
	title: string,
	description: string,
	messageText: string,
	parseMode: "Markdown" | "HTML" = "Markdown"
): TelegramBot.InlineQueryResultArticle {
	return {
		type: "article",
		id,
		title,
		description,
		input_message_content: {
			message_text: messageText,
			parse_mode: parseMode,
		},
		reply_markup: {
			inline_keyboard: [[{ text: "🤖 Open Bot", url: "t.me/YourBotUsername" }]],
		},
	};
}

function generateHelpText(): string {
	return `
*📚 Complete Help Guide*

*Getting Started:*
1. Send /start to begin
2. Use commands or buttons to interact
3. Send messages for responses

*Available Commands:*
• /start - Initialize the bot
• /help - Show this help message
• /info - Display bot information
• /settings - Configure your preferences
• /ping - Check bot responsiveness

*Features:*
✅ Text message processing
✅ Inline keyboards
✅ File handling
✅ Location sharing
✅ Inline mode
✅ Group chat support

*Tips:*
• Use inline mode by typing @YourBotUsername in any chat
• Commands work in both private and group chats
• The bot supports multiple languages
• All your data is secure and private

*Need Help?*
Contact the administrator for support.
  `.trim();
}

function generateCommandsList(): string {
	return `
*📝 Bot Commands*

*Basic Commands:*
• /start - Start the bot
• /help - Show help message
• /info - Bot information
• /settings - User settings
• /ping - Check bot status

*User Commands:*
• /profile - View your profile
• /stats - Your usage statistics
• /preferences - Set preferences

*Group Commands:*
• /rules - Show group rules
• /admins - List group admins

*Admin Commands:*
• /broadcast - Send announcement
• /users - Manage users
• /logs - View system logs
• /system - System information
  `.trim();
}

function generateBotInfo(): string {
	const uptime = process.uptime();
	const hours = Math.floor(uptime / 3600);
	const minutes = Math.floor((uptime % 3600) / 60);

	return `
*ℹ️ Bot Information*

*Status:* ✅ Online
*Version:* 1.0.0
*Uptime:* ${hours}h ${minutes}m
*Platform:* Node.js ${process.version}

*Features:*
• TypeScript powered
• Fast response time
• Secure data handling
• Multi-language support
• 24/7 availability

*Statistics:*
• Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
• Response Time: <100ms
• Reliability: 99.9%

*Developer:* @YourUsername
*Support:* @YourSupportChat
  `.trim();
}

export function createInlineButton(
	text: string,
	switchInlineQuery: string
): TelegramBot.InlineKeyboardButton {
	return {
		text,
		switch_inline_query: switchInlineQuery,
	};
}

export function createInlineCurrentChatButton(
	text: string,
	switchInlineQueryCurrentChat: string
): TelegramBot.InlineKeyboardButton {
	return {
		text,
		switch_inline_query_current_chat: switchInlineQueryCurrentChat,
	};
}
