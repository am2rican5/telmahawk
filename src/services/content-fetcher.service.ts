import { DOMParser } from "@xmldom/xmldom";

export interface FetchedContent {
	url: string;
	title: string;
	content: string;
	summary?: string;
	metadata: {
		description?: string;
		author?: string;
		publishedDate?: string;
		tags?: string[];
		language?: string;
		wordCount: number;
		fetchedAt: Date;
	};
}

export interface ContentChunk {
	content: string;
	chunkIndex: number;
	chunkSize: number;
	totalChunks: number;
}

export class ContentFetcherService {
	private readonly maxContentLength = 100000; // 100KB max per document
	private readonly chunkSize = 2000; // ~2000 characters per chunk
	private readonly chunkOverlap = 200; // Overlap between chunks for context

	/**
	 * Fetch and parse content from a URL
	 */
	async fetchContent(url: string): Promise<FetchedContent> {
		try {
			console.log(`Fetching content from: ${url}`);

			const response = await fetch(url, {
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; KnowledgeBot/1.0)",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.9",
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const html = await response.text();
			return this.parseHtmlContent(url, html);
		} catch (error) {
			console.error(`Error fetching content from ${url}:`, error);
			throw new Error(
				`Failed to fetch content: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}

	/**
	 * Parse HTML content and extract structured data
	 */
	private parseHtmlContent(url: string, html: string): FetchedContent {
		// Clean up HTML first
		const cleanHtml = this.cleanHtml(html);

		// For now, use a simple text extraction approach
		// In a production environment, you might want to use a proper HTML parser like cheerio
		const content = this.extractTextFromHtml(cleanHtml);
		const title = this.extractTitle(cleanHtml);
		const metadata = this.extractMetadata(cleanHtml);

		// Limit content length
		const truncatedContent =
			content.length > this.maxContentLength
				? content.substring(0, this.maxContentLength) + "..."
				: content;

		return {
			url,
			title,
			content: truncatedContent,
			summary: this.generateSummary(truncatedContent),
			metadata: {
				...metadata,
				wordCount: this.countWords(truncatedContent),
				fetchedAt: new Date(),
			},
		};
	}

	/**
	 * Clean HTML by removing scripts, styles, and other unwanted elements
	 */
	private cleanHtml(html: string): string {
		return (
			html
				// Remove script tags and content
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				// Remove style tags and content
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				// Remove comments
				.replace(/<!--[\s\S]*?-->/g, "")
				// Remove common non-content elements
				.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
				.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
				.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
				.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
		);
	}

	/**
	 * Extract text content from HTML
	 */
	private extractTextFromHtml(html: string): string {
		// Remove all HTML tags
		let text = html.replace(/<[^>]*>/g, " ");

		// Decode HTML entities
		text = text
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&#x2F;/g, "/")
			.replace(/&#\d+;/g, "");

		// Clean up whitespace
		text = text
			.replace(/\s+/g, " ")
			.replace(/\n\s*\n/g, "\n")
			.trim();

		return text;
	}

	/**
	 * Extract title from HTML
	 */
	private extractTitle(html: string): string {
		// Try to extract from title tag
		const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		if (titleMatch && titleMatch[1]) {
			return this.extractTextFromHtml(titleMatch[1]).trim();
		}

		// Try to extract from h1 tag
		const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
		if (h1Match && h1Match[1]) {
			return this.extractTextFromHtml(h1Match[1]).trim();
		}

		return "Untitled Document";
	}

	/**
	 * Extract metadata from HTML
	 */
	private extractMetadata(html: string): Partial<FetchedContent["metadata"]> {
		const metadata: Partial<FetchedContent["metadata"]> = {};

		// Extract description from meta tag
		const descMatch = html.match(
			/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
		);
		if (descMatch && descMatch[1]) {
			metadata.description = descMatch[1];
		}

		// Extract author from meta tag
		const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["']/i);
		if (authorMatch && authorMatch[1]) {
			metadata.author = authorMatch[1];
		}

		// Extract published date from various meta tags
		const dateMatch = html.match(
			/<meta[^>]*(?:name|property)=["'](?:article:published_time|publishedDate|datePublished)["'][^>]*content=["']([^"']*)["']/i
		);
		if (dateMatch && dateMatch[1]) {
			metadata.publishedDate = dateMatch[1];
		}

		// Extract language
		const langMatch = html.match(/<html[^>]*lang=["']([^"']*)["']/i);
		if (langMatch && langMatch[1]) {
			metadata.language = langMatch[1];
		}

		return metadata;
	}

	/**
	 * Generate a simple summary from content
	 */
	private generateSummary(content: string): string {
		// Take first few sentences up to ~300 characters
		const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
		let summary = "";

		for (const sentence of sentences) {
			if (summary.length + sentence.length > 300) break;
			summary += sentence.trim() + ". ";
		}

		return summary.trim() || content.substring(0, 300) + "...";
	}

	/**
	 * Count words in text
	 */
	private countWords(text: string): number {
		return text.split(/\s+/).filter((word) => word.length > 0).length;
	}

	/**
	 * Split content into chunks for storage
	 */
	chunkContent(content: string): ContentChunk[] {
		if (content.length <= this.chunkSize) {
			return [
				{
					content,
					chunkIndex: 0,
					chunkSize: content.length,
					totalChunks: 1,
				},
			];
		}

		const chunks: ContentChunk[] = [];
		let startPos = 0;
		let chunkIndex = 0;

		while (startPos < content.length) {
			let endPos = Math.min(startPos + this.chunkSize, content.length);

			// Try to break at a sentence or word boundary if possible
			if (endPos < content.length) {
				const sentenceEnd = content.lastIndexOf(".", endPos);
				const wordEnd = content.lastIndexOf(" ", endPos);

				if (sentenceEnd > startPos + this.chunkSize * 0.5) {
					endPos = sentenceEnd + 1;
				} else if (wordEnd > startPos + this.chunkSize * 0.5) {
					endPos = wordEnd;
				}
			}

			const chunkContent = content.substring(startPos, endPos).trim();

			if (chunkContent.length > 0) {
				chunks.push({
					content: chunkContent,
					chunkIndex,
					chunkSize: chunkContent.length,
					totalChunks: 0, // Will be set after all chunks are created
				});
				chunkIndex++;
			}

			// Move start position, accounting for overlap
			startPos = Math.max(endPos - this.chunkOverlap, startPos + 1);
		}

		// Update total chunks count
		chunks.forEach((chunk) => {
			chunk.totalChunks = chunks.length;
		});

		return chunks;
	}

	/**
	 * Fetch multiple URLs with rate limiting
	 */
	async fetchMultipleUrls(
		urls: string[],
		options: {
			concurrency?: number;
			delayMs?: number;
			onProgress?: (completed: number, total: number, currentUrl: string) => void;
		} = {}
	): Promise<{ url: string; content?: FetchedContent; error?: string }[]> {
		const { concurrency = 3, delayMs = 1000, onProgress } = options;
		const results: { url: string; content?: FetchedContent; error?: string }[] = [];

		// Process URLs in batches
		for (let i = 0; i < urls.length; i += concurrency) {
			const batch = urls.slice(i, i + concurrency);

			const batchPromises = batch.map(async (url) => {
				try {
					const content = await this.fetchContent(url);
					onProgress?.(i + batch.indexOf(url) + 1, urls.length, url);
					return { url, content };
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					onProgress?.(i + batch.indexOf(url) + 1, urls.length, url);
					return { url, error: errorMessage };
				}
			});

			const batchResults = await Promise.all(batchPromises);
			results.push(...batchResults);

			// Add delay between batches to be respectful
			if (i + concurrency < urls.length && delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}

		return results;
	}
}
