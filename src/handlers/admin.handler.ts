import type TelegramBot from "node-telegram-bot-api";
import type { BotInstance } from "../bot/bot";
import config from "../config/config";
import { getErrorHandler } from "../middleware/error.middleware";
import { getRequestLogger } from "../middleware/logging.middleware";
import { BotLogger } from "../utils/logger";
import type { CommandContext } from "./commands";

const logger = new BotLogger("AdminHandler");

export class AdminCommands {
	private bot: BotInstance;

	constructor(bot: BotInstance) {
		this.bot = bot;
		this.registerCommands();
	}

	private registerCommands(): void {
		const registry = (this.bot.getBot() as any).commandRegistry;
		if (!registry) return;

		registry.register("admin", this.handleAdmin.bind(this));
		registry.register("stats", this.handleStats.bind(this));
		registry.register("broadcast", this.handleBroadcast.bind(this));
		registry.register("users", this.handleUsers.bind(this));
		registry.register("logs", this.handleLogs.bind(this));
		registry.register("errors", this.handleErrors.bind(this));
		registry.register("system", this.handleSystem.bind(this));
		registry.register("block", this.handleBlock.bind(this));
		registry.register("unblock", this.handleUnblock.bind(this));
		registry.register("restart", this.handleRestart.bind(this));
	}

	private async checkAdmin(ctx: CommandContext): Promise<boolean> {
		const userId = ctx.msg.from?.id;
		if (!userId || !this.bot.isAdmin(userId)) {
			await ctx.bot.sendMessage(
				ctx.msg.chat.id,
				"⛔ This command requires administrator privileges."
			);
			return false;
		}
		return true;
	}

	private async handleAdmin(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const adminMenu = `
*👑 Admin Panel*

Available admin commands:

*User Management:*
/users - List all users
/block <user_id> - Block a user
/unblock <user_id> - Unblock a user

*System:*
/stats - Show bot statistics
/logs [limit] - View recent logs
/errors - View error reports
/system - System information
/restart - Restart the bot

*Communication:*
/broadcast <message> - Send message to all users

*Usage Examples:*
\`/block 123456789\`
\`/logs 50\`
\`/broadcast Hello everyone!\`
    `.trim();

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
				[{ text: "🔧 System", callback_data: "admin_system" }],
			],
		};

		await ctx.bot.sendMessage(ctx.msg.chat.id, adminMenu, {
			parse_mode: "Markdown",
			reply_markup: keyboard,
		});
	}

	private async handleStats(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const sessionManager = this.bot.getSessionManager();
		const requestLogger = getRequestLogger();
		const errorHandler = getErrorHandler();

		const sessions = sessionManager.getAllSessions();
		const activeUsers = sessionManager.getActiveSessionsCount();
		const logStats = requestLogger.getStats();
		const errorStats = errorHandler.getErrorStats();

		const uptime = process.uptime();
		const hours = Math.floor(uptime / 3600);
		const minutes = Math.floor((uptime % 3600) / 60);

		const statsMessage = `
*📊 Bot Statistics*

*Users:*
• Total Sessions: ${sessions.size}
• Active Users (30min): ${activeUsers}
• Admins: ${config.admin.userIds.length}

*Activity:*
• Total Requests: ${logStats.totalRequests}
• Requests/Hour: ${logStats.requestsPerHour}
• Avg Response Time: ${logStats.averageResponseTime.toFixed(2)}ms

*Commands Usage:*
${Array.from(logStats.commandUsage.entries())
	.sort((a, b) => b[1] - a[1])
	.slice(0, 5)
	.map(([cmd, count]) => `• /${cmd}: ${count}`)
	.join("\n")}

*Errors:*
• Total Errors: ${errorStats.total}
• Last Hour: ${errorStats.lastHour}
• Last 24 Hours: ${errorStats.last24Hours}

*System:*
• Uptime: ${hours}h ${minutes}m
• Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
• Node.js: ${process.version}
• Environment: ${config.server.environment}
    `.trim();

		await ctx.bot.sendMessage(ctx.msg.chat.id, statsMessage, {
			parse_mode: "Markdown",
		});
	}

	private async handleBroadcast(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const message = ctx.msg.text?.replace("/broadcast", "").trim();

		if (!message) {
			await ctx.bot.sendMessage(
				ctx.msg.chat.id,
				"❌ Please provide a message to broadcast.\n\nUsage: `/broadcast Your message here`",
				{ parse_mode: "Markdown" }
			);
			return;
		}

		const sessions = this.bot.getSessionManager().getAllSessions();
		let sent = 0;
		let failed = 0;

		const progressMsg = await ctx.bot.sendMessage(ctx.msg.chat.id, "📢 Broadcasting message...");

		for (const [userId] of sessions) {
			try {
				await this.bot.sendMessage(userId, `📢 *Broadcast Message*\n\n${message}`, {
					parse_mode: "Markdown",
				});
				sent++;
			} catch (error) {
				failed++;
				logger.error(`Failed to send broadcast to ${userId}`, error);
			}
		}

		await ctx.bot.editMessageText(`✅ Broadcast complete!\n\nSent: ${sent}\nFailed: ${failed}`, {
			chat_id: ctx.msg.chat.id,
			message_id: progressMsg.message_id,
		});
	}

	private async handleUsers(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const sessions = this.bot.getSessionManager().getAllSessions();
		const limit = parseInt(ctx.msg.text?.split(" ")[1] || "10", 10);

		const usersList = Array.from(sessions.values())
			.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
			.slice(0, limit)
			.map((session) => {
				const name = session.firstName || session.username || "Unknown";
				const status = session.isBlocked ? "🚫" : "✅";
				const lastSeen = new Date(session.lastActivity).toLocaleString();
				return `${status} ${name} (${session.userId})\n   Messages: ${session.messageCount} | Last: ${lastSeen}`;
			})
			.join("\n\n");

		const message = `
*👥 Users (Top ${limit})*

Total Users: ${sessions.size}

${usersList || "No users found"}

Use /users [limit] to see more users
    `.trim();

		await ctx.bot.sendMessage(ctx.msg.chat.id, message, {
			parse_mode: "Markdown",
		});
	}

	private async handleLogs(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const limit = parseInt(ctx.msg.text?.split(" ")[1] || "20", 10);
		const requestLogger = getRequestLogger();
		const logs = requestLogger.getLogs({ limit });

		const logEntries = logs
			.slice(-limit)
			.reverse()
			.map((log) => {
				const time = new Date(log.timestamp).toLocaleTimeString();
				const user = log.username ? `@${log.username}` : `ID:${log.userId}`;
				const content = log.command ? `/${log.command}` : log.callbackData || "message";
				return `[${time}] ${user}: ${content}`;
			})
			.join("\n");

		const message = `
*📝 Recent Logs (${Math.min(limit, logs.length)})*

\`\`\`
${logEntries || "No logs available"}
\`\`\`

Use /logs [limit] to see more logs
    `.trim();

		await ctx.bot.sendMessage(ctx.msg.chat.id, message, {
			parse_mode: "Markdown",
		});
	}

	private async handleErrors(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const errorHandler = getErrorHandler();
		const errorStats = errorHandler.getErrorStats();
		const errors = errorHandler.getErrorHistory().slice(-10);

		const errorList = errors
			.reverse()
			.map((err) => {
				const time = new Date(err.timestamp).toLocaleTimeString();
				const user = err.userId || "Unknown";
				return `[${time}] User ${user}: ${err.error.message}`;
			})
			.join("\n");

		const topErrors = errorStats.topErrors
			.map((err) => `• ${err.message}: ${err.count} times`)
			.join("\n");

		const message = `
*⚠️ Error Report*

*Statistics:*
• Total Errors: ${errorStats.total}
• Last Hour: ${errorStats.lastHour}
• Last 24 Hours: ${errorStats.last24Hours}

*Top Errors:*
${topErrors || "No errors recorded"}

*Recent Errors:*
\`\`\`
${errorList || "No recent errors"}
\`\`\`
    `.trim();

		await ctx.bot.sendMessage(ctx.msg.chat.id, message, {
			parse_mode: "Markdown",
		});
	}

	private async handleSystem(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const memUsage = process.memoryUsage();
		const uptime = process.uptime();
		const hours = Math.floor(uptime / 3600);
		const minutes = Math.floor((uptime % 3600) / 60);

		const systemInfo = `
*🔧 System Information*

*Process:*
• PID: ${process.pid}
• Platform: ${process.platform}
• Architecture: ${process.arch}
• Node.js: ${process.version}
• Uptime: ${hours}h ${minutes}m

*Memory Usage:*
• Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB
• Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB
• RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB
• External: ${Math.round(memUsage.external / 1024 / 1024)}MB

*Configuration:*
• Environment: ${config.server.environment}
• Port: ${config.server.port}
• Log Level: ${config.logging.level}
• Rate Limit: ${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs}ms
• Mode: ${config.bot.webhook ? "Webhook" : "Polling"}
    `.trim();

		await ctx.bot.sendMessage(ctx.msg.chat.id, systemInfo, {
			parse_mode: "Markdown",
		});
	}

	private async handleBlock(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const userId = parseInt(ctx.msg.text?.split(" ")[1] || "", 10);

		if (!userId) {
			await ctx.bot.sendMessage(
				ctx.msg.chat.id,
				"❌ Please provide a user ID.\n\nUsage: `/block <user_id>`",
				{ parse_mode: "Markdown" }
			);
			return;
		}

		this.bot.getSessionManager().blockUser(userId);

		await ctx.bot.sendMessage(ctx.msg.chat.id, `✅ User ${userId} has been blocked.`);

		logger.warn(`User ${userId} blocked by admin ${ctx.msg.from?.id}`);
	}

	private async handleUnblock(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		const userId = parseInt(ctx.msg.text?.split(" ")[1] || "", 10);

		if (!userId) {
			await ctx.bot.sendMessage(
				ctx.msg.chat.id,
				"❌ Please provide a user ID.\n\nUsage: `/unblock <user_id>`",
				{ parse_mode: "Markdown" }
			);
			return;
		}

		this.bot.getSessionManager().unblockUser(userId);

		await ctx.bot.sendMessage(ctx.msg.chat.id, `✅ User ${userId} has been unblocked.`);

		logger.info(`User ${userId} unblocked by admin ${ctx.msg.from?.id}`);
	}

	private async handleRestart(ctx: CommandContext): Promise<void> {
		if (!(await this.checkAdmin(ctx))) return;

		await ctx.bot.sendMessage(ctx.msg.chat.id, "🔄 Restarting bot...");

		logger.warn(`Bot restart requested by admin ${ctx.msg.from?.id}`);

		setTimeout(() => {
			process.exit(0);
		}, 1000);
	}
}

export function setupAdminHandlers(bot: BotInstance): AdminCommands {
	return new AdminCommands(bot);
}
