#!/usr/bin/env bun

import { KnowledgeIngestionService } from '../src/services/knowledge-ingestion.service';

async function ingestAlohaBlog() {
	const ingestionService = new KnowledgeIngestionService();
	
	console.log('🚀 Starting Aloha Corp blog ingestion...');
	console.log('This will fetch, process, and store all blog posts with embeddings.');
	console.log('');

	// Check if embedding service is available
	const { EmbeddingStorageService } = await import('../src/services/embedding-storage.service');
	const embeddingService = EmbeddingStorageService.getInstance();
	
	if (embeddingService.isEnabled()) {
		console.log('✅ Embedding service is enabled - embeddings will be generated');
	} else {
		console.log('⚠️  Embedding service is not enabled - no embeddings will be generated');
		console.log('   Make sure LLM_API_KEY is set in your .env file');
	}
	console.log('');

	// Show current stats before starting
	try {
		const beforeStats = await ingestionService.getIngestionStats();
		console.log('📊 Current Knowledge Base Stats:');
		console.log(`   Total Documents: ${beforeStats.totalDocuments}`);
		console.log(`   Total Chunks: ${beforeStats.totalChunks}`);
		console.log(`   Documents with Embeddings: ${beforeStats.documentsWithEmbeddings}`);
		console.log(`   Last Ingestion: ${beforeStats.lastIngestionDate ? beforeStats.lastIngestionDate.toLocaleString() : 'Never'}`);
		console.log('');
	} catch (error) {
		console.log('⚠️  Could not fetch current stats:', error);
		console.log('');
	}

	const startTime = Date.now();
	let lastProgressUpdate = 0;

	try {
		const result = await ingestionService.ingestAlohaBlog({
			concurrency: 3,          // Process 3 URLs at once
			delayMs: 1000,          // Wait 1 second between batches
			generateEmbeddings: true, // Generate embeddings for vector search
			chunkLargeDocuments: true, // Split large documents into chunks
			skipExisting: true,      // Skip documents that already exist
			onProgress: (progress) => {
				const now = Date.now();
				// Only update progress every 2 seconds to avoid spam
				if (now - lastProgressUpdate > 2000) {
					const percentage = Math.round((progress.completed / progress.total) * 100);
					console.log(`${getPhaseEmoji(progress.phase)} ${progress.phase.replace('_', ' ')}: ${progress.completed}/${progress.total} (${percentage}%)`);
					if (progress.currentItem) {
						console.log(`   Current: ${progress.currentItem}`);
					}
					lastProgressUpdate = now;
				}
			}
		});

		console.log('');
		console.log('🎉 Ingestion completed!');
		console.log('');
		console.log('📈 Results:');
		console.log(`   Total URLs found: ${result.totalUrls}`);
		console.log(`   URLs processed: ${result.processedUrls}`);
		console.log(`   Successful ingestions: ${result.successfulIngestions}`);
		console.log(`   Failed ingestions: ${result.failedIngestions}`);
		console.log(`   Duration: ${(result.duration / 1000).toFixed(1)}s`);
		console.log('');

		if (result.errors.length > 0) {
			console.log('❌ Errors encountered:');
			for (const error of result.errors.slice(0, 10)) { // Show max 10 errors
				console.log(`   ${error.url}: ${error.error}`);
			}
			if (result.errors.length > 10) {
				console.log(`   ... and ${result.errors.length - 10} more errors`);
			}
			console.log('');
		}

		// Show updated stats
		try {
			const afterStats = await ingestionService.getIngestionStats();
			console.log('📊 Updated Knowledge Base Stats:');
			console.log(`   Total Documents: ${afterStats.totalDocuments}`);
			console.log(`   Total Chunks: ${afterStats.totalChunks}`);
			console.log(`   Documents with Embeddings: ${afterStats.documentsWithEmbeddings}`);
			console.log('');
			console.log('📚 Documents by Source:');
			for (const sourceStats of afterStats.documentsBySource) {
				console.log(`   ${sourceStats.source}: ${sourceStats.count} documents`);
			}
		} catch (error) {
			console.log('⚠️  Could not fetch updated stats:', error);
		}

	} catch (error) {
		console.error('❌ Ingestion failed:', error);
		process.exit(1);
	} finally {
		await ingestionService.disconnect();
	}
}

function getPhaseEmoji(phase: string): string {
	switch (phase) {
		case 'fetching_sitemap': return '🗺️ ';
		case 'fetching_content': return '📄';
		case 'generating_embeddings': return '🧠';
		case 'storing_documents': return '💾';
		default: return '⚙️ ';
	}
}

// Run the ingestion
ingestAlohaBlog().catch(console.error);