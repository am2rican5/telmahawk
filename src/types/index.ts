import type TelegramBot from "node-telegram-bot-api";
import type { UserSession } from "../bot/session";
import type { AuthContext } from "../middleware/auth.middleware";

export interface ExtendedMessage extends TelegramBot.Message {
	authContext?: AuthContext;
	session?: UserSession;
	bot?: TelegramBot;
}

export interface ExtendedCallbackQuery extends TelegramBot.CallbackQuery {
	authContext?: AuthContext;
	session?: UserSession;
	bot?: TelegramBot;
}

export interface BotCommand {
	command: string;
	description: string;
	handler: (msg: ExtendedMessage) => Promise<void> | void;
	adminOnly?: boolean;
	privateOnly?: boolean;
	groupOnly?: boolean;
}

export interface BotConfig {
	token: string;
	polling?: TelegramBot.PollingOptions;
	webhook?: {
		domain: string;
		path: string;
		port: number;
	};
	admins?: number[];
	rateLimit?: {
		windowMs: number;
		maxRequests: number;
	};
	features?: {
		sessionManagement?: boolean;
		rateLimit?: boolean;
		errorHandling?: boolean;
		logging?: boolean;
		adminCommands?: boolean;
	};
}

export interface UserData {
	id: number;
	username?: string;
	firstName?: string;
	lastName?: string;
	languageCode?: string;
	isBot: boolean;
	isPremium?: boolean;
}

export interface ChatData {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
	title?: string;
	username?: string;
	description?: string;
	inviteLink?: string;
	memberCount?: number;
}

export interface MessageMetadata {
	messageId: number;
	chatId: number;
	userId: number;
	timestamp: Date;
	type: "text" | "photo" | "document" | "voice" | "video" | "location" | "sticker" | "other";
	replyTo?: number;
	editedAt?: Date;
}

export interface CallbackData {
	action: string;
	params?: Record<string, any>;
	page?: number;
	id?: string | number;
}

export interface BroadcastOptions {
	targetUsers?: number[];
	targetChats?: number[];
	excludeUsers?: number[];
	excludeChats?: number[];
	parseMode?: "Markdown" | "HTML";
	disableNotification?: boolean;
	schedule?: Date;
}

export interface Statistics {
	users: {
		total: number;
		active: number;
		blocked: number;
		new24h: number;
	};
	messages: {
		total: number;
		today: number;
		avgPerUser: number;
		types: Record<string, number>;
	};
	commands: {
		total: number;
		topCommands: Array<{ command: string; count: number }>;
	};
	errors: {
		total: number;
		last24h: number;
		topErrors: Array<{ message: string; count: number }>;
	};
	system: {
		uptime: number;
		memory: number;
		cpuUsage?: number;
	};
}

export interface NotificationOptions {
	userId: number;
	message: string;
	type?: "info" | "success" | "warning" | "error";
	priority?: "low" | "normal" | "high";
	persistent?: boolean;
	actions?: Array<{
		text: string;
		callbackData: string;
	}>;
}

export interface TaskSchedule {
	id: string;
	name: string;
	cronExpression?: string;
	interval?: number;
	handler: () => Promise<void> | void;
	enabled: boolean;
	lastRun?: Date;
	nextRun?: Date;
}

export interface WebhookRequest {
	update_id: number;
	message?: TelegramBot.Message;
	edited_message?: TelegramBot.Message;
	channel_post?: TelegramBot.Message;
	edited_channel_post?: TelegramBot.Message;
	inline_query?: TelegramBot.InlineQuery;
	chosen_inline_result?: TelegramBot.ChosenInlineResult;
	callback_query?: TelegramBot.CallbackQuery;
	shipping_query?: TelegramBot.ShippingQuery;
	pre_checkout_query?: TelegramBot.PreCheckoutQuery;
	poll?: TelegramBot.Poll;
	poll_answer?: TelegramBot.PollAnswer;
}

export enum UserRole {
	User = "user",
	Moderator = "moderator",
	Admin = "admin",
	SuperAdmin = "super_admin",
}

export enum MessagePriority {
	Low = 0,
	Normal = 1,
	High = 2,
	Urgent = 3,
}

export enum BotState {
	Idle = "idle",
	Processing = "processing",
	Error = "error",
	Maintenance = "maintenance",
}

export type Handler<T = void> = (context: T) => Promise<void> | void;

export type Middleware<T = any> = (context: T, next: () => Promise<void>) => Promise<void> | void;

export interface PaginationOptions {
	page: number;
	limit: number;
	total?: number;
}

export interface PaginatedResponse<T> {
	data: T[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		hasNext: boolean;
		hasPrev: boolean;
	};
}

export interface ErrorResponse {
	error: string;
	message: string;
	details?: any;
	timestamp: Date;
}

export interface SuccessResponse<T = any> {
	success: boolean;
	data?: T;
	message?: string;
	timestamp: Date;
}
