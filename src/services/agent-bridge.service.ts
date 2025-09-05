import type TelegramBot from "node-telegram-bot-api";
import type { Message } from "node-telegram-bot-api";
import type { SessionManager } from "../bot/session";
import { BotLogger } from "../utils/logger";
import { StatusIndicatorService } from "./status-indicator.service";
import { type AgentResponse, type ConversationInput, VoltagentService } from "./voltagent.service";

const logger = new BotLogger("KnowledgeAgentBridge");

export interface KnowledgeSession {
	conversationId: string;
	lastActivity: number;
}

export class AgentBridgeService {
	private static instance: AgentBridgeService;
	private voltagentService: VoltagentService;
	private statusService: StatusIndicatorService;
	private sessionManager!: SessionManager;
	private knowledgeSessions: Map<string, KnowledgeSession> = new Map();

	private constructor() {
		this.voltagentService = VoltagentService.getInstance();
		this.statusService = StatusIndicatorService.getInstance();
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
			// Start enhanced status indicator
			await this.statusService.startProcessingStatus(
				bot,
				msg.chat.id,
				userId,
				"🤖 질문을 분석하고 있습니다..."
			);

			// Get or create knowledge session
			const sessionKey = this.getUserSessionKey(userId);
			let knowledgeSession = this.knowledgeSessions.get(sessionKey);

			if (!knowledgeSession) {
				knowledgeSession = {
					conversationId: `tg-${userId}-knowledge`,
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

			// Update status to show agent processing
			await this.statusService.updateStatus(
				bot,
				msg.chat.id,
				userId,
				"🧠 AI 에이전트가 전문가 팀과 상담하고 있습니다..."
			);

			// Always use knowledge agent
			const response = await this.voltagentService.processMessage(input, "knowledge");

			// Stop status indicator (will be deleted automatically)
			await this.statusService.stopProcessingStatus(bot, msg.chat.id, userId);

			await this.sendFormattedResponse(bot, msg.chat.id, response);

			// Update session activity
			knowledgeSession.lastActivity = Date.now();
			this.knowledgeSessions.set(sessionKey, knowledgeSession);

			return true;
		} catch (error) {
			// Make sure to stop status indicator on error
			await this.statusService.stopProcessingStatus(bot, msg.chat.id, userId);
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

	public async performKnowledgeSearch(
		bot: TelegramBot,
		msg: Message,
		query: string
	): Promise<void> {
		const userId = msg.from?.id?.toString();
		if (!userId) {
			await bot.sendMessage(msg.chat.id, "Unable to identify user for search.");
			return;
		}

		try {
			// Start enhanced status indicator for search
			await this.statusService.startProcessingStatus(
				bot,
				msg.chat.id,
				userId,
				`🔍 "${query}" 검색 중...`
			);

			// Get or create knowledge session for search
			const sessionKey = this.getUserSessionKey(userId);
			let knowledgeSession = this.knowledgeSessions.get(sessionKey);

			if (!knowledgeSession) {
				knowledgeSession = {
					conversationId: `tg-${userId}-knowledge`,
					lastActivity: Date.now(),
				};
				this.knowledgeSessions.set(sessionKey, knowledgeSession);
			}

			const input: ConversationInput = {
				message: `Please search for: ${query}`,
				userId,
				conversationId: knowledgeSession.conversationId,
			};

			// Update status
			await this.statusService.updateStatus(
				bot,
				msg.chat.id,
				userId,
				"📚 지식 베이스에서 관련 문서를 찾고 있습니다..."
			);

			const response = await this.voltagentService.processMessage(input, "knowledge");

			// Stop status indicator
			await this.statusService.stopProcessingStatus(bot, msg.chat.id, userId);

			await this.sendFormattedResponse(bot, msg.chat.id, response);
		} catch (error) {
			// Clean up status on error
			await this.statusService.stopProcessingStatus(bot, msg.chat.id, userId);

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

		// Enhanced formatting for reasoning and search results
		formattedMessage = this.enhanceContentFormatting(formattedMessage);

		// Convert markdown to HTML and sanitize
		formattedMessage = this.convertMarkdownToHTML(formattedMessage);
		formattedMessage = this.sanitizeHTML(formattedMessage);

		// Validate HTML tags are properly balanced
		if (!this.validateHTMLTags(formattedMessage)) {
			logger.warn("HTML tags are not properly balanced, sending as plain text");
			formattedMessage = this.stripHTML(formattedMessage);
		}

		const MAX_MESSAGE_LENGTH = 4096;

		try {
			if (formattedMessage.length <= MAX_MESSAGE_LENGTH) {
				await bot.sendMessage(chatId, formattedMessage, {
					parse_mode: this.isValidHTML(formattedMessage) ? "HTML" : undefined,
				});
			} else {
				const chunks = this.splitLongMessage(formattedMessage, MAX_MESSAGE_LENGTH);
				for (const chunk of chunks) {
					await bot.sendMessage(chatId, chunk, {
						parse_mode: this.isValidHTML(chunk) ? "HTML" : undefined,
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

	private enhanceContentFormatting(text: string): string {
		// Enhance reasoning step formatting
		text = text.replace(/🤔\s*Thinking:/gi, "🤔 <b>Thinking:</b>");
		text = text.replace(/🔍\s*Analysis:/gi, "🔍 <b>Analysis:</b>");
		text = text.replace(/📊\s*Search Results:/gi, "📊 <b>Search Results:</b>");
		text = text.replace(/🌐\s*Web Results:/gi, "🌐 <b>Web Results:</b>");
		text = text.replace(/📄\s*Knowledge Base:/gi, "📄 <b>Knowledge Base:</b>");

		// Enhance source indicators
		text = text.replace(/\[Document (\d+)\]/g, "📄 <b>Document $1</b>");
		text = text.replace(/\[Web Result (\d+)\]/g, "🌐 <b>Web Result $1</b>");

		// Add visual separators for better readability
		text = text.replace(/---/g, "━━━━━━━━━━━━━━━━━━━━");

		return text;
	}

	private convertMarkdownToHTML(text: string): string {
		// First escape HTML entities in the raw text, but preserve our enhancements
		let html = this.escapeHTMLPreserveEnhancements(text);

		// Convert code blocks first (to avoid interfering with other formatting)
		html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, language, code) => {
			const cleanCode = code.trim();
			return `<pre><code>${cleanCode}</code></pre>`;
		});

		// Convert inline code
		html = html.replace(/`([^`]+)`/g, (match, code) => {
			return `<code>${code}</code>`;
		});

		// Convert links BEFORE other formatting to prevent nesting issues
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

		// Convert bold text (but not our already enhanced bold)
		html = html.replace(/\*\*((?!<\/b>).*?)\*\*/g, "<b>$1</b>");

		// Convert italic text (more careful to avoid breaking existing tags)
		html = html.replace(/\*(?!<[^>]*>)((?!<\/i>)[^*<>]*?)(?<!<[^>]*)\*/g, "<i>$1</i>");
		html = html.replace(/_(?!<[^>]*>)((?!<\/i>)[^_<>]*?)(?<!<[^>]*)_/g, "<i>$1</i>");

		// Convert bullet points
		html = html.replace(/^\s*[-•*]\s+(.+)$/gm, "• $1");

		// Convert numbered lists
		html = html.replace(/^\s*(\d+)\.\s+(.+)$/gm, "$1. $2");

		return html;
	}

	private escapeHTMLPreserveEnhancements(text: string): string {
		// First, temporarily replace our enhancements with placeholders
		const placeholders: { [key: string]: string } = {};
		let placeholderIndex = 0;

		// Preserve existing HTML tags from enhancements
		text = text.replace(/<\/?[bi]>/g, (match) => {
			const placeholder = `__PLACEHOLDER_${placeholderIndex++}__`;
			placeholders[placeholder] = match;
			return placeholder;
		});

		// Now escape HTML
		text = text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");

		// Restore placeholders
		for (const [placeholder, original] of Object.entries(placeholders)) {
			text = text.replace(placeholder, original);
		}

		return text;
	}

	private sanitizeHTML(text: string): string {
		// Enhanced sanitization: restore only allowed HTML tags
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
			.replace(/&lt;\/a&gt;/g, "</a>")
			.replace(/&lt;br\/?&gt;/g, "<br/>")
			.replace(/&lt;em&gt;/g, "<em>")
			.replace(/&lt;\/em&gt;/g, "</em>")
			.replace(/&lt;strong&gt;/g, "<strong>")
			.replace(/&lt;\/strong&gt;/g, "</strong>");

		// Clean up any remaining double escaping
		sanitized = sanitized
			.replace(/&amp;nbsp;/g, " ")
			.replace(/&amp;#39;/g, "'")
			.replace(/&amp;quot;/g, '"');

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
			.replace(/<b>(.*?)<\/b>/g, "*$1*") // Bold to markdown
			.replace(/<i>(.*?)<\/i>/g, "_$1_") // Italic to markdown
			.replace(/<em>(.*?)<\/em>/g, "_$1_") // Emphasis to markdown
			.replace(/<strong>(.*?)<\/strong>/g, "*$1*") // Strong to markdown
			.replace(/<u>(.*?)<\/u>/g, "$1") // Underline
			.replace(/<s>(.*?)<\/s>/g, "~$1~") // Strikethrough to markdown
			.replace(/<code>(.*?)<\/code>/g, "`$1`") // Inline code to markdown
			.replace(/<pre><code>(.*?)<\/code><\/pre>/gs, "```\n$1\n```") // Code blocks to markdown
			.replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/g, "$2 ($1)") // Links with URLs
			.replace(/<br\/?>/g, "\n") // Line breaks
			.replace(/━{10,}/g, "---") // Visual separators back to markdown
			.replace(/&amp;/g, "&") // Unescape HTML entities
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, " ");
	}

	private splitLongMessage(message: string, maxLength: number): string[] {
		const chunks: string[] = [];
		let currentChunk = "";

		// Try to split at natural boundaries first
		const sections = message.split(/(?=📄|🌐|🤔|🔍|📊|━{10,})/g);

		for (const section of sections) {
			if (section.trim() === "") continue;

			// If section is small enough, add it to current chunk
			if (currentChunk.length + section.length + 1 <= maxLength) {
				currentChunk += (currentChunk ? "\n" : "") + section;
			} else {
				// Save current chunk if it exists
				if (currentChunk) {
					chunks.push(currentChunk.trim());
					currentChunk = "";
				}

				// If section itself is too long, split by lines
				if (section.length > maxLength) {
					const lines = section.split("\n");
					for (const line of lines) {
						if (currentChunk.length + line.length + 1 > maxLength) {
							if (currentChunk) {
								chunks.push(currentChunk.trim());
								currentChunk = "";
							}

							if (line.length > maxLength) {
								// Split very long lines at word boundaries
								let remainingLine = line;
								while (remainingLine.length > maxLength) {
									let splitIndex = maxLength;
									// Try to split at word boundary
									const lastSpace = remainingLine.lastIndexOf(" ", maxLength);
									if (lastSpace > maxLength * 0.7) {
										splitIndex = lastSpace;
									}
									chunks.push(remainingLine.substring(0, splitIndex));
									remainingLine = remainingLine.substring(splitIndex).trim();
								}
								currentChunk = remainingLine;
							} else {
								currentChunk = line;
							}
						} else {
							currentChunk += (currentChunk ? "\n" : "") + line;
						}
					}
				} else {
					currentChunk = section;
				}
			}
		}

		if (currentChunk) {
			chunks.push(currentChunk.trim());
		}

		// Add chunk indicators if multiple chunks
		if (chunks.length > 1) {
			return chunks.map((chunk, index) => {
				const indicator = `[${index + 1}/${chunks.length}]`;
				return chunks.length > 1 && index === 0
					? `${indicator}\n${chunk}`
					: index > 0 && index < chunks.length - 1
						? `${indicator}\n${chunk}`
						: chunks.length > 1 && index === chunks.length - 1
							? `${indicator}\n${chunk}`
							: chunk;
			});
		}

		return chunks;
	}

	private getUserSessionKey(userId: string): string {
		return `agent_${userId}`;
	}

	private generateConversationId(userId: string): string {
		return `${userId}-knowledge-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
	}

	private validateHTMLTags(html: string): boolean {
		const stack: string[] = [];
		const tagRegex = /<\/?([a-zA-Z]+)(?:\s[^>]*)?>/g;
		let match: RegExpExecArray | null;

		while ((match = tagRegex.exec(html)) !== null) {
			const fullTag = match[0];
			const tagName = match[1].toLowerCase();

			// Skip self-closing tags like <br/>
			if (fullTag.endsWith("/>") || ["br", "hr", "img"].includes(tagName)) {
				continue;
			}

			if (fullTag.startsWith("</")) {
				// Closing tag
				if (stack.length === 0 || stack.pop() !== tagName) {
					return false; // Unmatched closing tag
				}
			} else {
				// Opening tag
				stack.push(tagName);
			}
		}

		return stack.length === 0; // All tags should be closed
	}

	private isValidHTML(text: string): boolean {
		// Check if text contains HTML tags and if they're balanced
		const hasHTMLTags = /<[^>]+>/g.test(text);
		return hasHTMLTags ? this.validateHTMLTags(text) : false;
	}
}
