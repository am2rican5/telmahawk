import { createTool } from "@voltagent/core";
import { z } from "zod";
import { BotLogger } from "../utils/logger";

const logger = new BotLogger("WebSearchTool");

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
	source: string;
	publishedDate?: Date;
	relevanceScore?: number;
}

export class WebSearchService {
	private static instance: WebSearchService;

	private constructor() {}

	public static getInstance(): WebSearchService {
		if (!WebSearchService.instance) {
			WebSearchService.instance = new WebSearchService();
		}
		return WebSearchService.instance;
	}

	/**
	 * Perform web search using available search APIs
	 * TODO: Integrate with actual search APIs (Google Custom Search, Bing Search, etc.)
	 */
	async search(
		query: string,
		options: {
			limit?: number;
			dateFilter?: "day" | "week" | "month" | "year";
			language?: string;
			country?: string;
		} = {}
	): Promise<WebSearchResult[]> {
		const { limit = 10, dateFilter, language = "en", country = "us" } = options;

		try {
			logger.info("Performing web search", { query, limit, dateFilter });

			// Mock results for now - replace with actual API calls
			const mockResults: WebSearchResult[] = [
				{
					title: `Recent developments: ${query}`,
					url: `https://news.example.com/article/${encodeURIComponent(query)}`,
					snippet: `Latest news and information about "${query}". This content would come from real search API results with current, up-to-date information from the web.`,
					source: "News Example",
					publishedDate: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random date within last week
					relevanceScore: 0.95,
				},
				{
					title: `Understanding ${query}: A comprehensive guide`,
					url: `https://blog.example.com/guide/${encodeURIComponent(query)}`,
					snippet: `Comprehensive guide covering everything you need to know about "${query}". Includes recent updates, best practices, and expert insights.`,
					source: "Tech Blog Example",
					publishedDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date within last month
					relevanceScore: 0.87,
				},
				{
					title: `${query} - Wikipedia`,
					url: `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
					snippet: `Wikipedia article about "${query}". Contains general information, history, and references to reliable sources.`,
					source: "Wikipedia",
					publishedDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000), // Random date within last year
					relevanceScore: 0.82,
				},
			];

			// Apply date filtering if specified
			let filteredResults = mockResults;
			if (dateFilter) {
				const cutoffDate = this.getCutoffDate(dateFilter);
				filteredResults = mockResults.filter(
					(result) => result.publishedDate && result.publishedDate >= cutoffDate
				);
			}

			// Sort by relevance score
			filteredResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

			return filteredResults.slice(0, limit);
		} catch (error) {
			logger.error("Web search error:", error);
			return [];
		}
	}

	private getCutoffDate(filter: "day" | "week" | "month" | "year"): Date {
		const now = new Date();
		switch (filter) {
			case "day":
				return new Date(now.getTime() - 24 * 60 * 60 * 1000);
			case "week":
				return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
			case "month":
				return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
			case "year":
				return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
			default:
				return new Date(0);
		}
	}
}

/**
 * Web search tool for agents
 */
export const webSearchTool = createTool({
	name: "web_search",
	description:
		"Search the web for current information, news, and recent developments. Use this tool when you need up-to-date information that might not be in the knowledge base.",
	parameters: z.object({
		query: z.string().describe("The search query to find information on the web"),
		limit: z
			.number()
			.optional()
			.default(5)
			.describe("Maximum number of search results to return (default: 5, max: 20)"),
		dateFilter: z
			.enum(["day", "week", "month", "year"])
			.optional()
			.describe("Filter results by recency (optional)"),
		includeSnippets: z
			.boolean()
			.optional()
			.default(true)
			.describe("Include content snippets in results (default: true)"),
	}),
	execute: async (args) => {
		try {
			const webSearchService = WebSearchService.getInstance();

			const results = await webSearchService.search(args.query, {
				limit: Math.min(args.limit || 5, 20), // Cap at 20 results
				dateFilter: args.dateFilter,
			});

			if (results.length === 0) {
				return {
					success: true,
					message: `No web search results found for: "${args.query}"`,
					query: args.query,
					results: [],
					totalFound: 0,
				};
			}

			// Format results for agent consumption
			const formattedResults = results.map((result, index) => ({
				rank: index + 1,
				title: result.title,
				url: result.url,
				snippet: args.includeSnippets ? result.snippet : undefined,
				source: result.source,
				publishedDate: result.publishedDate?.toISOString(),
				relevanceScore: result.relevanceScore,
			}));

			// Create a formatted context for RAG use
			const context = results
				.map((result, index) => {
					const dateStr = result.publishedDate
						? ` (Published: ${result.publishedDate.toLocaleDateString()})`
						: "";

					return `[Web Result ${index + 1}]${dateStr}
Title: ${result.title}
Source: ${result.source}
URL: ${result.url}
Content: ${result.snippet}`;
				})
				.join("\n\n---\n\n");

			return {
				success: true,
				message: `Found ${results.length} web search result(s) for: "${args.query}"`,
				query: args.query,
				results: formattedResults,
				totalFound: results.length,
				dateFilter: args.dateFilter,
				context, // RAG-ready context
			};
		} catch (error) {
			logger.error("Web search tool execution error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown web search error",
				query: args.query,
			};
		}
	},
});
