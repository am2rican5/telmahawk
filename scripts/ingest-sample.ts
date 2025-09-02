#!/usr/bin/env bun

import { KnowledgeIngestionService } from '../src/services/knowledge-ingestion.service';

async function ingestSampleBlog() {
	const ingestionService = new KnowledgeIngestionService();
	
	console.log('🚀 Starting sample blog ingestion with embeddings...');
	console.log('This will test with just a few URLs to verify embedding generation.');
	console.log('');

	try {
		// Get all URLs first
		const { SitemapService } = await import('../src/services/sitemap.service');
		const sitemapService = new SitemapService();
		const allUrls = await sitemapService.getAlohaBlogUrls();
		
		// Take only first 3 URLs for testing
		const sampleUrls = allUrls.slice(0, 3);
		
		console.log(`Found ${allUrls.length} total URLs, testing with ${sampleUrls.length} URLs:`);
		sampleUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url.loc}`));
		console.log('');

		const { ContentFetcherService } = await import('../src/services/content-fetcher.service');
		const contentFetcher = new ContentFetcherService();

		// Process each URL individually for better debugging
		for (const [index, sitemapUrl] of sampleUrls.entries()) {
			console.log(`\n--- Processing URL ${index + 1}/${sampleUrls.length} ---`);
			console.log(`URL: ${sitemapUrl.loc}`);

			try {
				// Fetch content
				console.log('📄 Fetching content...');
				const content = await contentFetcher.fetchContent(sitemapUrl.loc);
				console.log(`✅ Content fetched: "${content.title}" (${content.content.length} chars)`);

				// Store with embeddings
				console.log('💾 Storing document with embeddings...');
				const documentIds = await ingestionService['storeDocument'](content, { 
					generateEmbeddings: true, 
					chunkLargeDocuments: true 
				});
				
				console.log(`✅ Stored ${documentIds.length} document(s) with IDs: ${documentIds.join(', ')}`);

			} catch (error) {
				console.error(`❌ Error processing ${sitemapUrl.loc}:`, error);
			}
		}

		// Show final stats
		const stats = await ingestionService.getIngestionStats();
		console.log('\n📊 Final Knowledge Base Stats:');
		console.log(`   Total Documents: ${stats.totalDocuments}`);
		console.log(`   Total Chunks: ${stats.totalChunks}`);
		console.log(`   Documents with Embeddings: ${stats.documentsWithEmbeddings}`);

	} catch (error) {
		console.error('❌ Sample ingestion failed:', error);
		process.exit(1);
	} finally {
		await ingestionService.disconnect();
	}
}

ingestSampleBlog().catch(console.error);