import { DOMParser } from "@xmldom/xmldom";

export interface SitemapUrl {
	loc: string;
	lastmod?: string;
	changefreq?: string;
	priority?: string;
}

export class SitemapService {
	/**
	 * Parse a sitemap XML and extract all URLs
	 */
	async parseSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
		try {
			console.log(`Fetching sitemap from: ${sitemapUrl}`);

			const response = await fetch(sitemapUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch sitemap: ${response.status} ${response.statusText}`);
			}

			const xmlContent = await response.text();
			const parser = new DOMParser();
			const doc = parser.parseFromString(xmlContent, "text/xml");

			// Check if this is a sitemap index (contains other sitemaps)
			const sitemapElements = doc.getElementsByTagName("sitemap");
			if (sitemapElements.length > 0) {
				console.log(`Found sitemap index with ${sitemapElements.length} sitemaps`);
				return this.parseSitemapIndex(doc);
			}

			// Parse regular sitemap with URL entries
			const urlElements = doc.getElementsByTagName("url");
			const urls: SitemapUrl[] = [];

			for (let i = 0; i < urlElements.length; i++) {
				const urlElement = urlElements[i];
				const loc = this.getTextContent(urlElement, "loc");

				if (loc) {
					urls.push({
						loc,
						lastmod: this.getTextContent(urlElement, "lastmod"),
						changefreq: this.getTextContent(urlElement, "changefreq"),
						priority: this.getTextContent(urlElement, "priority"),
					});
				}
			}

			console.log(`Parsed ${urls.length} URLs from sitemap`);
			return urls;
		} catch (error) {
			console.error("Error parsing sitemap:", error);
			throw new Error(
				`Failed to parse sitemap: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	}

	/**
	 * Parse a sitemap index that contains references to other sitemaps
	 */
	private async parseSitemapIndex(doc: Document): Promise<SitemapUrl[]> {
		const sitemapElements = doc.getElementsByTagName("sitemap");
		const allUrls: SitemapUrl[] = [];

		for (let i = 0; i < sitemapElements.length; i++) {
			const sitemapElement = sitemapElements[i];
			const sitemapLoc = this.getTextContent(sitemapElement, "loc");

			if (sitemapLoc) {
				try {
					console.log(`Fetching sub-sitemap: ${sitemapLoc}`);
					const subSitemapUrls = await this.parseSitemap(sitemapLoc);
					allUrls.push(...subSitemapUrls);
				} catch (error) {
					console.error(`Error parsing sub-sitemap ${sitemapLoc}:`, error);
					// Continue with other sitemaps even if one fails
				}
			}
		}

		return allUrls;
	}

	/**
	 * Helper method to extract text content from XML elements
	 */
	private getTextContent(parentElement: Element, tagName: string): string | undefined {
		const elements = parentElement.getElementsByTagName(tagName);
		if (elements.length > 0 && elements[0].textContent) {
			return elements[0].textContent.trim();
		}
		return undefined;
	}

	/**
	 * Filter URLs by patterns (e.g., only blog posts)
	 */
	filterUrls(
		urls: SitemapUrl[],
		patterns: {
			include?: RegExp[];
			exclude?: RegExp[];
		}
	): SitemapUrl[] {
		return urls.filter((url) => {
			// Check exclude patterns first
			if (patterns.exclude) {
				for (const excludePattern of patterns.exclude) {
					if (excludePattern.test(url.loc)) {
						return false;
					}
				}
			}

			// Check include patterns
			if (patterns.include) {
				for (const includePattern of patterns.include) {
					if (includePattern.test(url.loc)) {
						return true;
					}
				}
				return false; // If include patterns are specified, URL must match at least one
			}

			return true; // No include patterns specified, include by default
		});
	}

	/**
	 * Get blog post URLs from Aloha Corp sitemap
	 */
	async getAlohaBlogUrls(): Promise<SitemapUrl[]> {
		const sitemapUrl = "https://blog.aloha-corp.com/sitemap.xml";
		const allUrls = await this.parseSitemap(sitemapUrl);

		// Filter to only include blog post URLs
		// Exclude common non-content pages
		return this.filterUrls(allUrls, {
			exclude: [
				/\/sitemap/i,
				/\/robots\.txt/i,
				/\/feed/i,
				/\/rss/i,
				/\/categories/i,
				/\/tags/i,
				/\/page\/\d+/i,
				/\/author\//i,
				/\/$/, // Homepage
			],
			include: [
				/blog\.aloha-corp\.com\/.*/, // All blog.aloha-corp.com URLs
			],
		});
	}
}
