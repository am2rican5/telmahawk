import { BotLogger } from "../utils/logger";

const logger = new BotLogger("SessionManager");

export interface UserSession {
	userId: number;
	username?: string;
	firstName?: string;
	lastName?: string;
	languageCode?: string;
	lastActivity: Date;
	state?: any;
	data: Map<string, any>;
	messageCount: number;
	commandCount: number;
	isBlocked: boolean;
	createdAt: Date;
}

export class SessionManager {
	private sessions: Map<number, UserSession> = new Map();
	private readonly SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
	private cleanupInterval: NodeJS.Timeout;

	constructor() {
		this.cleanupInterval = setInterval(
			() => this.cleanupExpiredSessions(),
			60 * 60 * 1000 // Run cleanup every hour
		);
	}

	public getSession(userId: number): UserSession | undefined {
		const session = this.sessions.get(userId);
		if (session) {
			session.lastActivity = new Date();
		}
		return session;
	}

	public createSession(
		userId: number,
		userData?: {
			username?: string;
			firstName?: string;
			lastName?: string;
			languageCode?: string;
		}
	): UserSession {
		const existingSession = this.sessions.get(userId);

		if (existingSession) {
			existingSession.lastActivity = new Date();
			return existingSession;
		}

		const session: UserSession = {
			userId,
			username: userData?.username,
			firstName: userData?.firstName,
			lastName: userData?.lastName,
			languageCode: userData?.languageCode,
			lastActivity: new Date(),
			data: new Map(),
			messageCount: 0,
			commandCount: 0,
			isBlocked: false,
			createdAt: new Date(),
		};

		this.sessions.set(userId, session);
		logger.info(`Session created for user ${userId}`);

		return session;
	}

	public updateSession(userId: number, updates: Partial<UserSession>): void {
		const session = this.sessions.get(userId);
		if (session) {
			Object.assign(session, updates);
			session.lastActivity = new Date();
		}
	}

	public deleteSession(userId: number): boolean {
		const result = this.sessions.delete(userId);
		if (result) {
			logger.info(`Session deleted for user ${userId}`);
		}
		return result;
	}

	public setSessionData(userId: number, key: string, value: any): void {
		const session = this.sessions.get(userId);
		if (session) {
			session.data.set(key, value);
			session.lastActivity = new Date();
		}
	}

	public getSessionData(userId: number, key: string): any {
		const session = this.sessions.get(userId);
		return session?.data.get(key);
	}

	public deleteSessionData(userId: number, key: string): boolean {
		const session = this.sessions.get(userId);
		if (session) {
			return session.data.delete(key);
		}
		return false;
	}

	public incrementMessageCount(userId: number): void {
		const session = this.sessions.get(userId);
		if (session) {
			session.messageCount++;
			session.lastActivity = new Date();
		}
	}

	public incrementCommandCount(userId: number): void {
		const session = this.sessions.get(userId);
		if (session) {
			session.commandCount++;
			session.lastActivity = new Date();
		}
	}

	public blockUser(userId: number): void {
		const session = this.sessions.get(userId);
		if (session) {
			session.isBlocked = true;
			logger.warn(`User ${userId} has been blocked`);
		}
	}

	public unblockUser(userId: number): void {
		const session = this.sessions.get(userId);
		if (session) {
			session.isBlocked = false;
			logger.info(`User ${userId} has been unblocked`);
		}
	}

	public isUserBlocked(userId: number): boolean {
		const session = this.sessions.get(userId);
		return session?.isBlocked || false;
	}

	public getAllSessions(): Map<number, UserSession> {
		return new Map(this.sessions);
	}

	public getActiveSessionsCount(): number {
		const now = Date.now();
		let activeCount = 0;

		for (const session of this.sessions.values()) {
			if (now - session.lastActivity.getTime() < 30 * 60 * 1000) {
				// Active in last 30 minutes
				activeCount++;
			}
		}

		return activeCount;
	}

	public getTotalSessionsCount(): number {
		return this.sessions.size;
	}

	private cleanupExpiredSessions(): void {
		const now = Date.now();
		let cleanedCount = 0;

		for (const [userId, session] of this.sessions.entries()) {
			if (now - session.lastActivity.getTime() > this.SESSION_TTL) {
				this.sessions.delete(userId);
				cleanedCount++;
			}
		}

		if (cleanedCount > 0) {
			logger.info(`Cleaned up ${cleanedCount} expired sessions`);
		}
	}

	public destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.sessions.clear();
		logger.info("SessionManager destroyed");
	}
}
