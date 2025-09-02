#!/usr/bin/env bun

import { PrismaClient } from '@prisma/client';

async function clearKnowledgeBase() {
	const prisma = new PrismaClient();
	
	try {
		console.log('🗑️  Clearing existing knowledge base...');
		
		// Delete all knowledge documents (cascades to chunks)
		const deleteResult = await prisma.knowledgeDocument.deleteMany({});
		
		console.log(`✅ Deleted ${deleteResult.count} knowledge documents`);
		console.log('Knowledge base cleared successfully!');
		
	} catch (error) {
		console.error('❌ Error clearing knowledge base:', error);
		process.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

clearKnowledgeBase().catch(console.error);