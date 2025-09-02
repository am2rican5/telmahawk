import type TelegramBot from "node-telegram-bot-api";
import type { Message } from "node-telegram-bot-api";
import type { SessionData, SessionManager } from "../bot/session";
import { BotLogger } from "../utils/logger";
import { type AgentResponse, type ConversationInput, VoltagentService } from "./voltagent.service";

const logger = new BotLogger("AgentBridge");

export interface AgentSession {
	agentType: string;
	conversationId: string;
	active: boolean;
	lastActivity: number;
}

export class AgentBridgeService {
	private static instance: AgentBridgeService;
	private voltagentService: VoltagentService;
	private sessionManager: SessionManager;
	private activeAgentSessions: Map<string, AgentSession> = new Map();

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
		logger.info("Agent bridge service initialized");
	}

	public async startAgentSession(userId: string, agentType: string): Promise<string> {
		if (!this.voltagentService.isEnabled()) {
			throw new Error("Voltagent service is not enabled");
		}

		const availableAgents = this.voltagentService.getAvailableAgents();
		if (!availableAgents.includes(agentType)) {
			throw new Error(
				`Agent type "${agentType}" is not available. Available agents: ${availableAgents.join(", ")}`
			);
		}

		const sessionKey = this.getUserSessionKey(userId);
		const conversationId = this.generateConversationId(userId, agentType);

		const agentSession: AgentSession = {
			agentType,
			conversationId,
			active: true,
			lastActivity: Date.now(),
		};

		this.activeAgentSessions.set(sessionKey, agentSession);

		const userIdNumber = parseInt(userId, 10);
		let session = this.sessionManager.getSession(userIdNumber);
		if (!session) {
			session = this.sessionManager.createSession(userIdNumber);
		}
		session.data.agentSession = agentSession;
		this.sessionManager.updateSession(userIdNumber, session);

		logger.info(`Started agent session for user ${userId}`, {
			agentType,
			conversationId,
		});

		return agentType;
	}

	public stopAgentSession(userId: string): boolean {
		const sessionKey = this.getUserSessionKey(userId);
		const agentSession = this.activeAgentSessions.get(sessionKey);

		if (!agentSession) {
			return false;
		}

		agentSession.active = false;
		this.activeAgentSessions.delete(sessionKey);

		const userIdNumber = parseInt(userId, 10);
		const session = this.sessionManager.getSession(userIdNumber);
		if (session) {
			delete session.data.agentSession;
			this.sessionManager.updateSession(userIdNumber, session);
		}

		logger.info(`Stopped agent session for user ${userId}`, {
			agentType: agentSession.agentType,
		});

		return true;
	}

	public async processMessage(bot: TelegramBot, msg: Message): Promise<boolean> {
		const userId = msg.from?.id?.toString();
		if (!userId) {
			return false;
		}

		const sessionKey = this.getUserSessionKey(userId);
		const agentSession = this.activeAgentSessions.get(sessionKey);

		if (!agentSession || !agentSession.active) {
			return false;
		}

		if (!msg.text) {
			await bot.sendMessage(
				msg.chat.id,
				"I can only process text messages. Please send a text message to continue our conversation."
			);
			return true;
		}

		try {
			await bot.sendChatAction(msg.chat.id, "typing");

			const input: ConversationInput = {
				message: msg.text,
				userId,
				conversationId: agentSession.conversationId,
			};

			const response = await this.voltagentService.processMessage(input, agentSession.agentType);

			await this.sendFormattedResponse(bot, msg.chat.id, response);

			agentSession.lastActivity = Date.now();
			this.activeAgentSessions.set(sessionKey, agentSession);

			const userIdNumber = parseInt(userId, 10);
			let session = this.sessionManager.getSession(userIdNumber);
			if (!session) {
				session = this.sessionManager.createSession(userIdNumber);
			}
			session.data.agentSession = agentSession;
			this.sessionManager.updateSession(userIdNumber, session);

			return true;
		} catch (error) {
			logger.error("Error processing agent message", error);

			await bot.sendMessage(
				msg.chat.id,
				"I'm sorry, I encountered an error while processing your message. Please try again or use /agent_stop to end the conversation."
			);

			return true;
		}
	}

	public getActiveAgentSession(userId: string): AgentSession | null {
		const sessionKey = this.getUserSessionKey(userId);
		const agentSession = this.activeAgentSessions.get(sessionKey);
		return agentSession && agentSession.active ? agentSession : null;
	}

	public getAvailableAgents(): string[] {
		return this.voltagentService.getAvailableAgents();
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

		if (formattedMessage.includes("```")) {
			formattedMessage = this.formatCodeBlocks(formattedMessage);
		}

		const MAX_MESSAGE_LENGTH = 4096;

		if (formattedMessage.length <= MAX_MESSAGE_LENGTH) {
			await bot.sendMessage(chatId, formattedMessage, {
				parse_mode: "Markdown",
			});
		} else {
			const chunks = this.splitLongMessage(formattedMessage, MAX_MESSAGE_LENGTH);
			for (const chunk of chunks) {
				await bot.sendMessage(chatId, chunk, {
					parse_mode: "Markdown",
				});
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	}

	private formatCodeBlocks(text: string): string {
		return text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
			return `\`\`\`${language || ""}\n${code.trim()}\n\`\`\``;
		});
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

	private generateConversationId(userId: string, agentType: string): string {
		return `${userId}-${agentType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
	}
}
