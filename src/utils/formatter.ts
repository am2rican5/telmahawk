import type TelegramBot from "node-telegram-bot-api";

export type MessageTemplate = "greeting" | "welcome" | "error" | "success" | "warning" | "info";

const templates: Record<MessageTemplate, (data?: any) => string> = {
	greeting: (data) => `Hello ${data?.name || "there"}! 👋 How can I help you today?`,
	welcome: (data) => `Welcome ${data?.name || "to our community"}, ${data?.chatName || "here"}! 🎉`,
	error: (data) => `❌ Error: ${data?.message || "Something went wrong"}`,
	success: (data) => `✅ Success: ${data?.message || "Operation completed"}`,
	warning: (data) => `⚠️ Warning: ${data?.message || "Please be careful"}`,
	info: (data) => `ℹ️ Info: ${data?.message || "Information"}`,
};

export function formatMessage(template: MessageTemplate, data?: any): string {
	return templates[template](data);
}

export function escapeMarkdown(text: string): string {
	return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

export function escapeHTML(text: string): string {
	const map: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#039;",
	};
	return text.replace(/[&<>"']/g, (m) => map[m]);
}

export function formatCode(code: string, language?: string): string {
	if (language) {
		return `\`\`\`${language}\n${code}\n\`\`\``;
	}
	return `\`${code}\``;
}

export function formatBold(text: string): string {
	return `*${escapeMarkdown(text)}*`;
}

export function formatItalic(text: string): string {
	return `_${escapeMarkdown(text)}_`;
}

export function formatUnderline(text: string): string {
	return `__${escapeMarkdown(text)}__`;
}

export function formatStrike(text: string): string {
	return `~${escapeMarkdown(text)}~`;
}

export function formatLink(text: string, url: string): string {
	return `[${escapeMarkdown(text)}](${url})`;
}

export function formatMention(userId: number, name: string): string {
	return `[${escapeMarkdown(name)}](tg://user?id=${userId})`;
}

export function formatList(items: string[], ordered: boolean = false): string {
	return items.map((item, index) => (ordered ? `${index + 1}. ${item}` : `• ${item}`)).join("\n");
}

export function formatTable(headers: string[], rows: string[][]): string {
	const formatRow = (row: string[]) => row.join(" | ");

	const headerRow = formatRow(headers);
	const separator = headers.map(() => "---").join(" | ");
	const dataRows = rows.map(formatRow).join("\n");

	return `\`\`\`\n${headerRow}\n${separator}\n${dataRows}\n\`\`\``;
}

export function truncateText(text: string, maxLength: number = 100): string {
	if (text.length <= maxLength) return text;
	return `${text.substring(0, maxLength - 3)}...`;
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 Bytes";

	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	const parts = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(" ");
}

export function formatDate(date: Date, includeTime: boolean = true): string {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "short",
		day: "numeric",
	};

	if (includeTime) {
		options.hour = "2-digit";
		options.minute = "2-digit";
	}

	return date.toLocaleString("en-US", options);
}

export function formatNumber(num: number): string {
	return num.toLocaleString("en-US");
}

export function formatPercentage(value: number, total: number): string {
	if (total === 0) return "0%";
	return `${((value / total) * 100).toFixed(1)}%`;
}

export function createProgressBar(current: number, total: number, length: number = 10): string {
	const percentage = total > 0 ? current / total : 0;
	const filled = Math.round(percentage * length);
	const empty = length - filled;

	const bar = "█".repeat(filled) + "░".repeat(empty);
	return `[${bar}] ${formatPercentage(current, total)}`;
}

export function createKeyboard(
	buttons: string[][],
	options?: Partial<TelegramBot.ReplyKeyboardMarkup>
): TelegramBot.ReplyKeyboardMarkup {
	return {
		keyboard: buttons.map((row) => row.map((text) => ({ text }))),
		resize_keyboard: true,
		one_time_keyboard: false,
		...options,
	};
}

export function createInlineKeyboard(
	buttons: (TelegramBot.InlineKeyboardButton | string)[][]
): TelegramBot.InlineKeyboardMarkup {
	return {
		inline_keyboard: buttons.map((row) =>
			row.map((button) =>
				typeof button === "string"
					? { text: button, callback_data: button.toLowerCase().replace(/\s+/g, "_") }
					: button
			)
		),
	};
}

export function removeKeyboard(): TelegramBot.ReplyKeyboardRemove {
	return {
		remove_keyboard: true,
	};
}
