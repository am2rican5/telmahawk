import type TelegramBot from "node-telegram-bot-api";
import type { Message } from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import { BotLogger } from "../utils/logger";
import { type AgentResponse, type ConversationInput, VoltagentService } from "./voltagent.service";

const logger = new BotLogger("KnowledgeAgentBridge");

export interface KnowledgeSession {
	conversationId: string;
	lastActivity: number;
}

export class AgentBridgeService {
	private static instance: AgentBridgeService;
	private voltagentService: VoltagentService;
	private sessionManager!: SessionManager;
	private knowledgeSessions: Map<string, KnowledgeSession> = new Map();

	private constructor() {
		this.voltagentService = VoltagentService.getInstance();
	}

	public static getInstance(): AgentBridgeService {
		if (!AgentBridgeService.instance) {
			AgentBridgeService.instance = new AgentBridgeService();
		}
		return AgentBridgeService.instance;
	}

	public initialize(sessionManager: SessionManager): void {
		this.sessionManager = sessionManager;
		logger.info("Knowledge agent bridge service initialized");
	}

	public clearConversation(userId: string): boolean {
		const sessionKey = this.getUserSessionKey(userId);
		const knowledgeSession = this.knowledgeSessions.get(sessionKey);

		if (!knowledgeSession) {
			return false;
		}

		this.knowledgeSessions.delete(sessionKey);

		const userIdNumber = parseInt(userId, 10);
		const session = this.sessionManager.getSession(userIdNumber);
		if (session) {
			delete session.data.knowledgeSession;
			this.sessionManager.updateSession(userIdNumber, session);
		}

		logger.info(`Cleared conversation for user ${userId}`);
		return true;
	}

	public async processMessage(bot: TelegramBot, msg: Message): Promise<boolean> {
		const userId = msg.from?.id?.toString();
		if (!userId) {
			return false;
		}

		if (!this.voltagentService.isEnabled()) {
			return false;
		}

		if (!msg.text) {
			await bot.sendMessage(
				msg.chat.id,
				"I can only process text messages. Please send a text message for me to help you find information."
			);
			return true;
		}

		try {
			await bot.sendChatAction(msg.chat.id, "typing");

			// Get or create knowledge session
			const sessionKey = this.getUserSessionKey(userId);
			let knowledgeSession = this.knowledgeSessions.get(sessionKey);

			if (!knowledgeSession) {
				knowledgeSession = {
					conversationId: this.generateConversationId(userId),
					lastActivity: Date.now(),
				};
				this.knowledgeSessions.set(sessionKey, knowledgeSession);

				// Update user session
				const userIdNumber = parseInt(userId, 10);
				let session = this.sessionManager.getSession(userIdNumber);
				if (!session) {
					session = this.sessionManager.createSession(userIdNumber);
				}
				session.data.knowledgeSession = knowledgeSession;
				this.sessionManager.updateSession(userIdNumber, session);
			}

			const input: ConversationInput = {
				message: msg.text,
				userId,
				conversationId: knowledgeSession.conversationId,
			};

			// Always use knowledge agent
			const response = await this.voltagentService.processMessage(input, "knowledge");

			await this.sendFormattedResponse(bot, msg.chat.id, response);

			// Update session activity
			knowledgeSession.lastActivity = Date.now();
			this.knowledgeSessions.set(sessionKey, knowledgeSession);

			return true;
		} catch (error) {
			logger.error("Error processing knowledge query", error);

			await bot.sendMessage(
				msg.chat.id,
				"I'm sorry, I encountered an error while searching for information. Please try rephrasing your question."
			);

			return true;
		}
	}

	public getKnowledgeSession(userId: string): KnowledgeSession | null {
		const sessionKey = this.getUserSessionKey(userId);
		return this.knowledgeSessions.get(sessionKey) || null;
	}

	public async performKnowledgeSearch(bot: TelegramBot, msg: Message, query: string): Promise<void> {
		try {
			await bot.sendChatAction(msg.chat.id, "typing");

			const userId = msg.from?.id?.toString();
			if (!userId) {
				await bot.sendMessage(msg.chat.id, "Unable to identify user for search.");
				return;
			}

			const input: ConversationInput = {
				message: `Please search for: ${query}`,
				userId,
				conversationId: `search-${userId}-${Date.now()}`,
			};

			const response = await this.voltagentService.processMessage(input, "knowledge");
			await this.sendFormattedResponse(bot, msg.chat.id, response);
		} catch (error) {
			logger.error("Error performing knowledge search", error);
			await bot.sendMessage(
				msg.chat.id,
				"I encountered an error while searching. Please try again with different keywords."
			);
		}
	}

	public isEnabled(): boolean {
		return this.voltagentService.isEnabled();
	}

	private async sendFormattedResponse(
		bot: TelegramBot,
		chatId: number,
		response: AgentResponse
	): Promise<void> {
		let formattedMessage = response.content;

		// Convert markdown to HTML and sanitize
		formattedMessage = this.convertMarkdownToHTML(formattedMessage);
		formattedMessage = this.sanitizeHTML(formattedMessage);

		const MAX_MESSAGE_LENGTH = 4096;

		try {
			if (formattedMessage.length <= MAX_MESSAGE_LENGTH) {
				await bot.sendMessage(chatId, formattedMessage, {
					parse_mode: "HTML",
				});
			} else {
				const chunks = this.splitLongMessage(formattedMessage, MAX_MESSAGE_LENGTH);
				for (const chunk of chunks) {
					await bot.sendMessage(chatId, chunk, {
						parse_mode: "HTML",
					});
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
		} catch (error) {
			// If HTML parsing fails, send as plain text
			logger.warn("HTML parsing failed, sending as plain text", { error });
			const plainMessage = this.stripHTML(formattedMessage);
			
			if (plainMessage.length <= MAX_MESSAGE_LENGTH) {
				await bot.sendMessage(chatId, plainMessage);
			} else {
				const chunks = this.splitLongMessage(plainMessage, MAX_MESSAGE_LENGTH);
				for (const chunk of chunks) {
					await bot.sendMessage(chatId, chunk);
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
		}
	}

	private convertMarkdownToHTML(text: string): string {
		// First escape HTML entities in the raw text
		let html = this.escapeHTML(text);
		
		// Convert code blocks first (to avoid interfering with other formatting)
		html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, language, code) => {
			const cleanCode = code.trim();
			return `<pre><code>${cleanCode}</code></pre>`;
		});
		
		// Convert inline code
		html = html.replace(/`([^`]+)`/g, (match, code) => {
			return `<code>${code}</code>`;
		});
		
		// Convert bold text
		html = html.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
		
		// Convert italic text
		html = html.replace(/\*(.*?)\*/g, "<i>$1</i>");
		html = html.replace(/_(.*?)_/g, "<i>$1</i>");
		
		// Convert links - [text](url)
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
		
		return html;
	}

	private sanitizeHTML(text: string): string {
		// Much simpler approach: restore only the HTML tags we created
		let sanitized = text;
		
		// Restore allowed HTML tags that were escaped
		sanitized = sanitized
			.replace(/&lt;b&gt;/g, "<b>")
			.replace(/&lt;\/b&gt;/g, "</b>")
			.replace(/&lt;i&gt;/g, "<i>")
			.replace(/&lt;\/i&gt;/g, "</i>")
			.replace(/&lt;u&gt;/g, "<u>")
			.replace(/&lt;\/u&gt;/g, "</u>")
			.replace(/&lt;s&gt;/g, "<s>")
			.replace(/&lt;\/s&gt;/g, "</s>")
			.replace(/&lt;code&gt;/g, "<code>")
			.replace(/&lt;\/code&gt;/g, "</code>")
			.replace(/&lt;pre&gt;/g, "<pre>")
			.replace(/&lt;\/pre&gt;/g, "</pre>")
			.replace(/&lt;a href=&quot;([^&]+)&quot;&gt;/g, '<a href="$1">')
			.replace(/&lt;\/a&gt;/g, "</a>");
		
		return sanitized;
	}

	private escapeHTML(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	private stripHTML(text: string): string {
		return text
			.replace(/<b>(.*?)<\/b>/g, "$1") // Bold
			.replace(/<i>(.*?)<\/i>/g, "$1") // Italic
			.replace(/<u>(.*?)<\/u>/g, "$1") // Underline
			.replace(/<s>(.*?)<\/s>/g, "$1") // Strikethrough
			.replace(/<code>(.*?)<\/code>/g, "$1") // Inline code
			.replace(/<pre><code>(.*?)<\/code><\/pre>/gs, "$1") // Code blocks
			.replace(/<a\s[^>]*>(.*?)<\/a>/g, "$1") // Links
			.replace(/&amp;/g, "&") // Unescape HTML entities
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, "\"")
			.replace(/&#39;/g, "'");
	}

	private splitLongMessage(message: string, maxLength: number): string[] {
		const chunks: string[] = [];
		let currentChunk = "";

		const lines = message.split("\n");
		for (const line of lines) {
			if (currentChunk.length + line.length + 1 > maxLength) {
				if (currentChunk) {
					chunks.push(currentChunk.trim());
					currentChunk = "";
				}

				if (line.length > maxLength) {
					let remainingLine = line;
					while (remainingLine.length > maxLength) {
						chunks.push(remainingLine.substring(0, maxLength));
						remainingLine = remainingLine.substring(maxLength);
					}
					currentChunk = remainingLine;
				} else {
					currentChunk = line;
				}
			} else {
				currentChunk += (currentChunk ? "\n" : "") + line;
			}
		}

		if (currentChunk) {
			chunks.push(currentChunk.trim());
		}

		return chunks;
	}

	private getUserSessionKey(userId: string): string {
		return `agent_${userId}`;
	}

	private generateConversationId(userId: string): string {
		return `${userId}-knowledge-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
	}
}
