import type TelegramBot from "node-telegram-bot-api";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("StatusIndicatorService");

interface StatusMessage {
	chatId: number;
	messageId: number;
	startTime: number;
	intervalId?: NodeJS.Timeout;
}

export class StatusIndicatorService {
	private static instance: StatusIndicatorService;
	private activeStatus: Map<string, StatusMessage> = new Map();

	private constructor() {}

	public static getInstance(): StatusIndicatorService {
		if (!StatusIndicatorService.instance) {
			StatusIndicatorService.instance = new StatusIndicatorService();
		}
		return StatusIndicatorService.instance;
	}

	/**
	 * Start showing processing status with periodic updates
	 */
	public async startProcessingStatus(
		bot: TelegramBot,
		chatId: number,
		userId: string,
		initialMessage = "🤖 처리 중..."
	): Promise<void> {
		try {
			// Send typing action
			await bot.sendChatAction(chatId, "typing");

			// Send initial status message
			const sentMessage = await bot.sendMessage(chatId, initialMessage);

			const statusKey = this.getStatusKey(chatId, userId);
			const statusData: StatusMessage = {
				chatId,
				messageId: sentMessage.message_id,
				startTime: Date.now(),
			};

			// Set up periodic updates
			statusData.intervalId = setInterval(async () => {
				try {
					await this.updateStatusMessage(bot, statusData);
					// Send typing action periodically to keep the indicator active
					await bot.sendChatAction(chatId, "typing");
				} catch (error) {
					logger.error("Error updating status message", error);
				}
			}, 3000); // Update every 3 seconds

			this.activeStatus.set(statusKey, statusData);

			logger.info(`Started processing status for user ${userId} in chat ${chatId}`);
		} catch (error) {
			logger.error("Error starting processing status", error);
		}
	}

	/**
	 * Update the status message with elapsed time and activity indicator
	 */
	private async updateStatusMessage(bot: TelegramBot, status: StatusMessage): Promise<void> {
		const elapsed = Math.floor((Date.now() - status.startTime) / 1000);
		const dots = this.getActivityDots(elapsed);
		const timeStr = this.formatElapsedTime(elapsed);

		const statusMessages = [
			`🤖 지식 검색 중${dots}`,
			`📚 문서 분석 중${dots}`,
			`🔍 정보 검증 중${dots}`,
			`📝 답변 준비 중${dots}`,
		];

		// Cycle through different status messages
		const messageIndex = Math.floor(elapsed / 4) % statusMessages.length;
		const statusText = `${statusMessages[messageIndex]}\n⏱️ ${timeStr}`;

		try {
			await bot.editMessageText(statusText, {
				chat_id: status.chatId,
				message_id: status.messageId,
			});
		} catch (error) {
			// Ignore edit errors (message might be too old to edit)
			if (!error.message?.includes("message is not modified")) {
				logger.warn("Could not update status message", { error: error.message });
			}
		}
	}

	/**
	 * Stop processing status and clean up
	 */
	public async stopProcessingStatus(
		bot: TelegramBot,
		chatId: number,
		userId: string,
		finalMessage?: string
	): Promise<void> {
		const statusKey = this.getStatusKey(chatId, userId);
		const status = this.activeStatus.get(statusKey);

		if (!status) {
			return;
		}

		try {
			// Clear interval
			if (status.intervalId) {
				clearInterval(status.intervalId);
			}

			// Update with final message or delete the status message
			if (finalMessage) {
				await bot.editMessageText(finalMessage, {
					chat_id: status.chatId,
					message_id: status.messageId,
				});
			} else {
				// Delete the status message
				await bot.deleteMessage(status.chatId, status.messageId);
			}

			this.activeStatus.delete(statusKey);

			const elapsed = Math.floor((Date.now() - status.startTime) / 1000);
			logger.info(`Stopped processing status for user ${userId} after ${elapsed}s`);
		} catch (error) {
			logger.error("Error stopping processing status", error);
			// Still clean up the tracking
			this.activeStatus.delete(statusKey);
		}
	}

	/**
	 * Update status with a specific message
	 */
	public async updateStatus(
		bot: TelegramBot,
		chatId: number,
		userId: string,
		message: string
	): Promise<void> {
		const statusKey = this.getStatusKey(chatId, userId);
		const status = this.activeStatus.get(statusKey);

		if (!status) {
			return;
		}

		try {
			const elapsed = Math.floor((Date.now() - status.startTime) / 1000);
			const timeStr = this.formatElapsedTime(elapsed);
			const statusText = `${message}\n⏱️ ${timeStr}`;

			await bot.editMessageText(statusText, {
				chat_id: status.chatId,
				message_id: status.messageId,
			});
		} catch (error) {
			if (!error.message?.includes("message is not modified")) {
				logger.warn("Could not update status with custom message", { error: error.message });
			}
		}
	}

	/**
	 * Check if there's an active status for a user
	 */
	public hasActiveStatus(chatId: number, userId: string): boolean {
		const statusKey = this.getStatusKey(chatId, userId);
		return this.activeStatus.has(statusKey);
	}

	/**
	 * Clean up old status messages (called periodically)
	 */
	public cleanup(): void {
		const now = Date.now();
		const CLEANUP_THRESHOLD = 5 * 60 * 1000; // 5 minutes

		for (const [key, status] of this.activeStatus.entries()) {
			if (now - status.startTime > CLEANUP_THRESHOLD) {
				if (status.intervalId) {
					clearInterval(status.intervalId);
				}
				this.activeStatus.delete(key);
				logger.info(`Cleaned up stale status for key: ${key}`);
			}
		}
	}

	private getStatusKey(chatId: number, userId: string): string {
		return `${chatId}_${userId}`;
	}

	private getActivityDots(elapsedSeconds: number): string {
		const dotCount = (elapsedSeconds % 4) + 1;
		return ".".repeat(dotCount);
	}

	private formatElapsedTime(seconds: number): string {
		if (seconds < 60) {
			return `${seconds}초`;
		}

		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;

		if (minutes < 60) {
			return `${minutes}분 ${remainingSeconds}초`;
		}

		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return `${hours}시간 ${remainingMinutes}분 ${remainingSeconds}초`;
	}
}
