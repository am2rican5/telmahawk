import type TelegramBot from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import { AgentBridgeService } from "../services/agent-bridge.service";
import { formatMessage } from "../utils/formatter";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("MessageHandler");

export function setupMessageHandlers(bot: TelegramBot, sessionManager: SessionManager): void {
	const agentBridge = AgentBridgeService.getInstance();
	agentBridge.initialize(sessionManager);

	bot.on("message", async (msg) => {
		if (msg.text?.startsWith("/")) {
			return;
		}

		const session = (msg as any).session;
		if (session) {
			sessionManager.incrementMessageCount(msg.from?.id || 0);
		}

		if (agentBridge.isEnabled() && msg.text) {
			const handled = await agentBridge.processMessage(bot, msg);
			if (handled) {
				return;
			}
		}

		if (msg.text) {
			await handleTextMessage(bot, msg);
		} else if (msg.photo) {
			await handlePhotoMessage(bot, msg);
		} else if (msg.document) {
			await handleDocumentMessage(bot, msg);
		} else if (msg.voice) {
			await handleVoiceMessage(bot, msg);
		} else if (msg.video) {
			await handleVideoMessage(bot, msg);
		} else if (msg.location) {
			await handleLocationMessage(bot, msg);
		} else if (msg.contact) {
			await handleContactMessage(bot, msg);
		} else if (msg.sticker) {
			await handleStickerMessage(bot, msg);
		} else {
			await handleUnknownMessage(bot, msg);
		}
	});

	bot.on("new_chat_members", async (msg) => {
		await handleNewChatMembers(bot, msg);
	});

	bot.on("left_chat_member", async (msg) => {
		await handleLeftChatMember(bot, msg);
	});
}

async function handleTextMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	const text = msg.text || "";
	const userId = msg.from?.id;

	logger.info(`Text message received`, { userId, text: text.substring(0, 50) });

	const greetings = [
		"hi",
		"hello",
		"hey",
		"greetings",
		"good morning",
		"good afternoon",
		"good evening",
	];
	const lowerText = text.toLowerCase();

	if (greetings.some((greeting) => lowerText.includes(greeting))) {
		const response = formatMessage("greeting", {
			name: msg.from?.first_name || "there",
		});
		await bot.sendMessage(msg.chat.id, response);
		return;
	}

	if (lowerText.includes("thank")) {
		await bot.sendMessage(msg.chat.id, "You're welcome! Happy to help! 😊");
		return;
	}

	if (lowerText.includes("help")) {
		await bot.sendMessage(msg.chat.id, "Need help? Try /help command to see what I can do!");
		return;
	}

	await bot.sendMessage(
		msg.chat.id,
		`I received your message: "${text}"\n\nTry /help to see available commands.`
	);
}

async function handlePhotoMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Photo message received`, { userId: msg.from?.id });

	if (!msg.photo || msg.photo.length === 0) {
		return;
	}

	const largestPhoto = msg.photo[msg.photo.length - 1];
	await bot.getFile(largestPhoto.file_id);

	await bot.sendMessage(
		msg.chat.id,
		`📸 Photo received!\nFile size: ${largestPhoto.file_size} bytes\nDimensions: ${largestPhoto.width}x${largestPhoto.height}`
	);
}

async function handleDocumentMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Document message received`, {
		userId: msg.from?.id,
		fileName: msg.document?.file_name,
	});

	await bot.sendMessage(
		msg.chat.id,
		`📄 Document received: ${msg.document?.file_name}\nSize: ${msg.document?.file_size} bytes`
	);
}

async function handleVoiceMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Voice message received`, { userId: msg.from?.id });

	await bot.sendMessage(
		msg.chat.id,
		`🎤 Voice message received!\nDuration: ${msg.voice?.duration} seconds`
	);
}

async function handleVideoMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Video message received`, { userId: msg.from?.id });

	await bot.sendMessage(
		msg.chat.id,
		`🎥 Video received!\nDuration: ${msg.video?.duration} seconds\nDimensions: ${msg.video?.width}x${msg.video?.height}`
	);
}

async function handleLocationMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Location message received`, { userId: msg.from?.id });

	await bot.sendMessage(
		msg.chat.id,
		`📍 Location received!\nLatitude: ${msg.location?.latitude}\nLongitude: ${msg.location?.longitude}`
	);
}

async function handleContactMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Contact message received`, { userId: msg.from?.id });

	await bot.sendMessage(
		msg.chat.id,
		`👤 Contact received!\nName: ${msg.contact?.first_name} ${msg.contact?.last_name || ""}\nPhone: ${msg.contact?.phone_number}`
	);
}

async function handleStickerMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.info(`Sticker message received`, { userId: msg.from?.id });

	await bot.sendMessage(msg.chat.id, `🎨 Nice sticker! "${msg.sticker?.emoji || ""}"`);
}

async function handleUnknownMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	logger.warn(`Unknown message type received`, { userId: msg.from?.id });

	await bot.sendMessage(
		msg.chat.id,
		"I received your message but I'm not sure how to handle this type yet."
	);
}

async function handleNewChatMembers(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	if (!msg.new_chat_members) return;

	for (const member of msg.new_chat_members) {
		if (member.is_bot) continue;

		const welcomeMessage = formatMessage("welcome", {
			name: member.first_name,
			chatName: msg.chat.title || "the group",
		});

		await bot.sendMessage(msg.chat.id, welcomeMessage);
		logger.info(`New member welcomed`, {
			userId: member.id,
			chatId: msg.chat.id,
		});
	}
}

async function handleLeftChatMember(_bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
	if (!msg.left_chat_member) return;

	logger.info(`Member left chat`, {
		userId: msg.left_chat_member.id,
		chatId: msg.chat.id,
	});
}
