-- Enable PostgreSQL extensions for knowledge document search
-- This script should be run with superuser privileges

-- Enable vector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for trigram text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable full text search extension
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Create GIN indexes for better text search performance on knowledge_documents table
CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_content_gin_idx 
ON knowledge_documents USING gin(to_tsvector('english', content));

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_title_gin_idx 
ON knowledge_documents USING gin(to_tsvector('english', title));

-- Create trigram indexes for similarity search
CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_content_trgm_idx 
ON knowledge_documents USING gin(content gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_documents_title_trgm_idx 
ON knowledge_documents USING gin(title gin_trgm_ops);

-- Create index for vector similarity search (when embedding field is used)
-- Note: This will be created dynamically when embeddings are added