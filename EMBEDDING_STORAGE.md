# Embedding Storage System

This document explains the new embedding storage system that saves embeddings to a database and returns record IDs instead of full vectors for better performance and usability.

## Overview

Instead of returning large embedding vectors directly, the system now:
1. Generates embeddings using Google AI models
2. Stores them in a PostgreSQL database (Supabase)
3. Returns a record ID for future reference
4. Provides tools to retrieve embeddings when needed

## Setup

### 1. Database Configuration

Ensure your `.env` file has the correct `DATABASE_URL`:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### 2. Create Database Schema

Run the following command to create the embeddings table in your Supabase database:

```bash
bun run db:push
```

Or for development with migrations:

```bash
bun run db:migrate
```

### 3. Available Commands

```bash
# Generate Prisma client after schema changes
bun run db:generate

# Push schema directly to database (no migrations)
bun run db:push

# Create and run migrations
bun run db:migrate

# Open Prisma Studio for database management
bun run db:studio
```

## Usage

### 1. Text Embedding Tool

Generate and store embeddings:

```javascript
// Agent call example
await agent.generateText("Create an embedding for: 'Hello world'", {
  tools: { text_embedding: embeddingTool }
});
```

**Parameters:**
- `text` (required): Text to generate embedding for
- `model` (optional): "gemini-embedding-001" or "text-embedding-004"
- `taskType` (optional): Purpose of embedding (SEMANTIC_SIMILARITY, CLASSIFICATION, etc.)
- `outputDimensionality` (optional): Reduce vector dimensions (1-3072)
- `returnVector` (optional): Return full vector instead of just ID (default: false)

**Response (default - ID only):**
```json
{
  "success": true,
  "embeddingId": "uuid-string",
  "stored": true,
  "dimensions": 768,
  "model": "gemini-embedding-001",
  "text": "Hello world",
  "createdAt": "2024-01-01T00:00:00Z",
  "usage": { "tokens": 2 }
}
```

### 2. Embedding Retrieval Tool

Retrieve stored embeddings:

```javascript
// Get metadata only
await agent.generateText("Get embedding info for ID: uuid-string", {
  tools: { get_embedding: retrievalTool }
});

// Get full embedding with vector
await agent.generateText("Get full embedding with vector for ID: uuid-string", {
  tools: { get_embedding: retrievalTool }
});
```

**Parameters:**
- `embeddingId` (required): UUID of stored embedding
- `includeVector` (optional): Include embedding vector in response (default: false)

**Response (metadata only):**
```json
{
  "success": true,
  "embeddingId": "uuid-string",
  "text": "Hello world",
  "model": "gemini-embedding-001",
  "dimensions": 768,
  "metadata": { "usage": { "tokens": 2 } },
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

## Database Schema

The embeddings table includes:

```sql
CREATE TABLE embeddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text         TEXT NOT NULL,
  embedding    JSONB NOT NULL,     -- Vector stored as JSON array
  model        TEXT NOT NULL,      -- Model used for generation
  task_type    TEXT,               -- Optional task type
  dimensions   INTEGER NOT NULL,   -- Vector dimensions
  metadata     JSONB,              -- Additional metadata
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_embeddings_created_at ON embeddings(created_at);
CREATE INDEX idx_embeddings_model ON embeddings(model);
CREATE INDEX idx_embeddings_task_type ON embeddings(task_type);
```

## Benefits

1. **Manageable Responses**: No more overwhelming vector arrays in chat responses
2. **Efficient Storage**: Centralized embedding storage for reuse
3. **Better UX**: Clean, readable responses with meaningful IDs
4. **Scalable**: Database storage allows for similarity search and analytics
5. **Flexible**: Can retrieve vectors when needed for computations

## Error Handling

The system gracefully handles:
- Database connection failures (falls back to returning vectors)
- Storage service unavailable (continues with vector response)
- Invalid embedding IDs (returns error with clear message)
- Network timeouts (proper error reporting)

## Integration

The embedding storage is automatically initialized when:
1. `DATABASE_URL` is configured in environment
2. VoltagentService starts up
3. Database connection is successful

The system works seamlessly with existing agents and requires no changes to agent usage patterns.