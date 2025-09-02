#!/usr/bin/env bun

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function setupExtensions() {
	console.log('Setting up PostgreSQL extensions...');

	try {
		// Check if vector extension is available
		console.log('Checking vector extension...');
		try {
			await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
			console.log('✅ Vector extension enabled');
		} catch (error) {
			console.log('⚠️  Vector extension not available or already enabled:', error instanceof Error ? error.message : 'Unknown error');
		}

		// Check if pg_trgm extension is available
		console.log('Checking pg_trgm extension...');
		try {
			await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
			console.log('✅ pg_trgm extension enabled');
		} catch (error) {
			console.log('⚠️  pg_trgm extension not available or already enabled:', error instanceof Error ? error.message : 'Unknown error');
		}

		// Check if unaccent extension is available
		console.log('Checking unaccent extension...');
		try {
			await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS unaccent;');
			console.log('✅ unaccent extension enabled');
		} catch (error) {
			console.log('⚠️  unaccent extension not available or already enabled:', error instanceof Error ? error.message : 'Unknown error');
		}

		// Create text search indexes
		console.log('Creating text search indexes...');
		try {
			await prisma.$executeRawUnsafe(`
				CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_content_gin_idx 
				ON knowledge_documents USING gin(to_tsvector('english', content));
			`);
			console.log('✅ Content GIN index created');
		} catch (error) {
			console.log('⚠️  Content GIN index creation failed:', error instanceof Error ? error.message : 'Unknown error');
		}

		try {
			await prisma.$executeRawUnsafe(`
				CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_title_gin_idx 
				ON knowledge_documents USING gin(to_tsvector('english', title));
			`);
			console.log('✅ Title GIN index created');
		} catch (error) {
			console.log('⚠️  Title GIN index creation failed:', error instanceof Error ? error.message : 'Unknown error');
		}

		// Create trigram indexes if pg_trgm is available
		try {
			await prisma.$executeRawUnsafe(`
				CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_content_trgm_idx 
				ON knowledge_documents USING gin(content gin_trgm_ops);
			`);
			console.log('✅ Content trigram index created');
		} catch (error) {
			console.log('⚠️  Content trigram index creation failed:', error instanceof Error ? error.message : 'Unknown error');
		}

		try {
			await prisma.$executeRawUnsafe(`
				CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_title_trgm_idx 
				ON knowledge_documents USING gin(title gin_trgm_ops);
			`);
			console.log('✅ Title trigram index created');
		} catch (error) {
			console.log('⚠️  Title trigram index creation failed:', error instanceof Error ? error.message : 'Unknown error');
		}

		console.log('🎉 Extension setup completed!');
	} catch (error) {
		console.error('❌ Error setting up extensions:', error);
		process.exit(1);
	} finally {
		await prisma.$disconnect();
	}
}

setupExtensions();