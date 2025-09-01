export class Validator {
	static isValidUserId(userId: any): boolean {
		return typeof userId === "number" && userId > 0;
	}

	static isValidChatId(chatId: any): boolean {
		return typeof chatId === "number" || typeof chatId === "string";
	}

	static isValidCommand(text: string): boolean {
		return /^\/[a-zA-Z0-9_]+/.test(text);
	}

	static isValidUrl(url: string): boolean {
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	}

	static isValidEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}

	static isValidPhoneNumber(phone: string): boolean {
		const phoneRegex = /^\+?[1-9]\d{1,14}$/;
		return phoneRegex.test(phone.replace(/[\s-]/g, ""));
	}

	static isValidUsername(username: string): boolean {
		return /^[a-zA-Z0-9_]{5,32}$/.test(username);
	}

	static isWithinLength(text: string, min: number, max: number): boolean {
		return text.length >= min && text.length <= max;
	}

	static containsOnlyNumbers(text: string): boolean {
		return /^\d+$/.test(text);
	}

	static containsOnlyLetters(text: string): boolean {
		return /^[a-zA-Z]+$/.test(text);
	}

	static isAlphanumeric(text: string): boolean {
		return /^[a-zA-Z0-9]+$/.test(text);
	}

	static isValidDate(dateString: string): boolean {
		const date = new Date(dateString);
		return date instanceof Date && !Number.isNaN(date.getTime());
	}

	static isValidJson(jsonString: string): boolean {
		try {
			JSON.parse(jsonString);
			return true;
		} catch {
			return false;
		}
	}

	static sanitizeInput(input: string): string {
		return input.trim().replace(/[<>]/g, "").replace(/\s+/g, " ").substring(0, 1000);
	}

	static validateRequired<T>(value: T | undefined | null, fieldName: string): T {
		if (value === undefined || value === null) {
			throw new Error(`${fieldName} is required`);
		}
		return value;
	}

	static validateEnum<T>(value: T, validValues: T[], fieldName: string): T {
		if (!validValues.includes(value)) {
			throw new Error(`Invalid ${fieldName}. Must be one of: ${validValues.join(", ")}`);
		}
		return value;
	}

	static validateRange(value: number, min: number, max: number, fieldName: string): number {
		if (value < min || value > max) {
			throw new Error(`${fieldName} must be between ${min} and ${max}`);
		}
		return value;
	}

	static validatePattern(
		value: string,
		pattern: RegExp,
		fieldName: string,
		message?: string
	): string {
		if (!pattern.test(value)) {
			throw new Error(message || `${fieldName} has invalid format`);
		}
		return value;
	}
}

export class InputSanitizer {
	static removeEmoji(text: string): string {
		return text.replace(
			/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
			""
		);
	}

	static removeHtml(text: string): string {
		return text.replace(/<[^>]*>/g, "");
	}

	static removeMarkdown(text: string): string {
		return text
			.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
			.replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
			.replace(/~{1,2}([^~]+)~{1,2}/g, "$1")
			.replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
	}

	static normalizeWhitespace(text: string): string {
		return text.replace(/\s+/g, " ").trim();
	}

	static truncate(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return `${text.substring(0, maxLength - 3)}...`;
	}

	static extractNumbers(text: string): number[] {
		const matches = text.match(/\d+/g);
		return matches ? matches.map(Number) : [];
	}

	static extractUrls(text: string): string[] {
		const urlRegex = /(https?:\/\/[^\s]+)/g;
		const matches = text.match(urlRegex);
		return matches || [];
	}

	static extractEmails(text: string): string[] {
		const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
		const matches = text.match(emailRegex);
		return matches || [];
	}

	static extractHashtags(text: string): string[] {
		const hashtagRegex = /#[a-zA-Z0-9_]+/g;
		const matches = text.match(hashtagRegex);
		return matches || [];
	}

	static extractMentions(text: string): string[] {
		const mentionRegex = /@[a-zA-Z0-9_]+/g;
		const matches = text.match(mentionRegex);
		return matches || [];
	}
}

export class ValidationError extends Error {
	constructor(
		public field: string,
		public value: any,
		message: string
	) {
		super(message);
		this.name = "ValidationError";
	}
}

export function validateInput<T>(input: any, schema: ValidationSchema): T {
	const errors: ValidationError[] = [];
	const result: any = {};

	for (const [field, rules] of Object.entries(schema)) {
		const value = input[field];

		try {
			if (rules.required && (value === undefined || value === null)) {
				throw new ValidationError(field, value, `${field} is required`);
			}

			if (value !== undefined && value !== null) {
				if (rules.type) {
					const actualType = Array.isArray(value) ? "array" : typeof value;
					if (actualType !== rules.type) {
						throw new ValidationError(field, value, `${field} must be of type ${rules.type}`);
					}
				}

				if (rules.minLength && value.length < rules.minLength) {
					throw new ValidationError(
						field,
						value,
						`${field} must be at least ${rules.minLength} characters`
					);
				}

				if (rules.maxLength && value.length > rules.maxLength) {
					throw new ValidationError(
						field,
						value,
						`${field} must be at most ${rules.maxLength} characters`
					);
				}

				if (rules.min !== undefined && value < rules.min) {
					throw new ValidationError(field, value, `${field} must be at least ${rules.min}`);
				}

				if (rules.max !== undefined && value > rules.max) {
					throw new ValidationError(field, value, `${field} must be at most ${rules.max}`);
				}

				if (rules.pattern && !rules.pattern.test(value)) {
					throw new ValidationError(field, value, `${field} has invalid format`);
				}

				if (rules.enum && !rules.enum.includes(value)) {
					throw new ValidationError(
						field,
						value,
						`${field} must be one of: ${rules.enum.join(", ")}`
					);
				}

				if (rules.custom && !rules.custom(value)) {
					throw new ValidationError(field, value, `${field} failed custom validation`);
				}

				result[field] = rules.transform ? rules.transform(value) : value;
			}
		} catch (error) {
			if (error instanceof ValidationError) {
				errors.push(error);
			} else {
				throw error;
			}
		}
	}

	if (errors.length > 0) {
		const message = errors.map((e) => e.message).join(", ");
		throw new Error(`Validation failed: ${message}`);
	}

	return result as T;
}

export interface ValidationRule {
	required?: boolean;
	type?: "string" | "number" | "boolean" | "array" | "object";
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	pattern?: RegExp;
	enum?: any[];
	custom?: (value: any) => boolean;
	transform?: (value: any) => any;
}

export type ValidationSchema = Record<string, ValidationRule>;
