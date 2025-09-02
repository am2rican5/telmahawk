#!/usr/bin/env bun

import { KnowledgeRetriever } from '../src/retrievers/knowledge.retriever';
import { KnowledgeIngestionService } from '../src/services/knowledge-ingestion.service';

async function testKnowledgeSystem() {
	console.log('🧪 Testing Knowledge Retrieval System...');
	console.log('');

	const knowledgeRetriever = new KnowledgeRetriever();
	const ingestionService = new KnowledgeIngestionService();

	try {
		// Check current knowledge base stats
		console.log('📊 Current Knowledge Base Status:');
		const stats = await ingestionService.getIngestionStats();
		console.log(`   Total Documents: ${stats.totalDocuments}`);
		console.log(`   Total Chunks: ${stats.totalChunks}`);
		console.log(`   Documents with Embeddings: ${stats.documentsWithEmbeddings}`);
		console.log(`   Last Ingestion: ${stats.lastIngestionDate ? stats.lastIngestionDate.toLocaleString() : 'Never'}`);
		console.log('');

		if (stats.totalDocuments === 0) {
			console.log('⚠️  No documents in knowledge base. Run the ingestion script first:');
			console.log('   bun run scripts/ingest-aloha-blog.ts');
			console.log('');
			return;
		}

		// Test queries
		const testQueries = [
			"What is Aloha Corp?",
			"How does the company work?",
			"What services does Aloha provide?",
			"Tell me about their technology"
		];

		console.log('🔍 Testing search functionality...');
		console.log('');

		for (const [index, query] of testQueries.entries()) {
			console.log(`Query ${index + 1}: "${query}"`);
			
			try {
				// Test text search
				console.log('   📝 Text Search:');
				const textResults = await knowledgeRetriever.textSearch(query, { limit: 3 });
				console.log(`      Found ${textResults.length} results`);
				
				if (textResults.length > 0) {
					console.log(`      Top result: "${textResults[0].title}"`);
				}

				// Test vector search (if embeddings are available)
				if (stats.documentsWithEmbeddings > 0) {
					console.log('   🔍 Vector Search:');
					const vectorResults = await knowledgeRetriever.vectorSearch(query, { limit: 3, threshold: 0.5 });
					console.log(`      Found ${vectorResults.length} results`);
					
					if (vectorResults.length > 0) {
						const topResult = vectorResults[0];
						console.log(`      Top result: "${topResult.title}" (similarity: ${topResult.similarity?.toFixed(3)})`);
					}
				}

				// Test hybrid search
				console.log('   🔄 Hybrid Search:');
				const hybridResults = await knowledgeRetriever.hybridSearch(query, { limit: 3 });
				console.log(`      Found ${hybridResults.length} results`);
				
				if (hybridResults.length > 0) {
					const topResult = hybridResults[0];
					console.log(`      Top result: "${topResult.title}" (relevance: ${topResult.similarity?.toFixed(3)})`);
				}

				// Test RAG retrieval
				console.log('   🤖 RAG Retrieval:');
				const ragResult = await knowledgeRetriever.retrieve(query, { limit: 2 });
				const resultPreview = ragResult.length > 100 ? ragResult.substring(0, 100) + '...' : ragResult;
				console.log(`      Result preview: "${resultPreview}"`);

				console.log('');

			} catch (error) {
				console.error(`   ❌ Error testing query "${query}":`, error);
				console.log('');
			}
		}

		// Test the tool interface
		console.log('🛠️  Testing Tool Interface...');
		const tool = knowledgeRetriever.tool;
		
		try {
			const toolResult = await tool.execute({
				query: "What is Aloha Corp?",
				limit: 2,
				searchMode: "hybrid" as const
			});
			
			console.log('   Tool execution result:');
			console.log(`   Success: ${toolResult.success}`);
			if (toolResult.success && 'results' in toolResult) {
				console.log(`   Results found: ${toolResult.results.length}`);
				if (toolResult.results.length > 0) {
					console.log(`   First result title: "${toolResult.results[0].title}"`);
				}
			}
		} catch (error) {
			console.error('   ❌ Tool execution error:', error);
		}

		console.log('');
		console.log('🎉 Knowledge system test completed!');
		
		if (stats.documentsWithEmbeddings === 0) {
			console.log('💡 Tip: Run the ingestion script to generate embeddings for better search results:');
			console.log('   bun run scripts/ingest-aloha-blog.ts');
		}

	} catch (error) {
		console.error('❌ Test failed:', error);
		process.exit(1);
	} finally {
		await knowledgeRetriever.disconnect();
		await ingestionService.disconnect();
	}
}

testKnowledgeSystem().catch(console.error);