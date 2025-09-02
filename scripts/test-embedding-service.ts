#!/usr/bin/env bun

import { EmbeddingStorageService } from '../src/services/embedding-storage.service';

async function testEmbeddingService() {
	console.log('🧪 Testing EmbeddingStorageService...');
	console.log('');

	const embeddingService = EmbeddingStorageService.getInstance();
	
	console.log('Environment variables:');
	console.log(`LLM_PROVIDER: ${process.env.LLM_PROVIDER}`);
	console.log(`LLM_API_KEY: ${process.env.LLM_API_KEY ? '***set***' : 'not set'}`);
	console.log(`GOOGLE_GENERATIVE_AI_API_KEY: ${process.env.GOOGLE_GENERATIVE_AI_API_KEY ? '***set***' : 'not set'}`);
	console.log('');

	try {
		// Initialize the service
		console.log('Initializing EmbeddingStorageService...');
		await embeddingService.initialize();
		console.log('✅ Service initialized');
		
		// Check if enabled
		const isEnabled = embeddingService.isEnabled();
		console.log(`Service enabled: ${isEnabled}`);
		
		if (isEnabled) {
			// Try to generate a test embedding
			console.log('Generating test embedding...');
			const testText = "This is a test document for embedding generation.";
			const embedding = await embeddingService.generateEmbedding(testText, "document");
			
			if (embedding) {
				console.log(`✅ Embedding generated successfully (${embedding.length} dimensions)`);
				console.log(`First few values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
			} else {
				console.log('❌ Failed to generate embedding');
			}
		} else {
			console.log('❌ Service is not enabled');
		}

	} catch (error) {
		console.error('❌ Error:', error);
	} finally {
		await embeddingService.shutdown();
	}
}

testEmbeddingService().catch(console.error);