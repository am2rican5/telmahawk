-- Conversations Table
CREATE TABLE IF NOT EXISTS voltagent_memory_conversations (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    user_id TEXT,  -- Associates conversation with user (nullable)
    title TEXT,
    metadata JSONB, -- Use JSONB for efficient querying
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for faster lookup by resource_id
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_conversations_resource
ON voltagent_memory_conversations(resource_id);

-- Index for faster lookup by user_id
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_conversations_user
ON voltagent_memory_conversations(user_id);

-- Composite index for user_id + resource_id queries
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_conversations_user_resource
ON voltagent_memory_conversations(user_id, resource_id);

-- Index for ordering by updated_at (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_conversations_updated_at
ON voltagent_memory_conversations(updated_at DESC);

-- Messages Table
CREATE TABLE IF NOT EXISTS voltagent_memory_messages (
    conversation_id TEXT NOT NULL REFERENCES voltagent_memory_conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL, -- Consider JSONB if content is often structured
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Primary key: conversation_id + message_id ensures uniqueness within conversation
    PRIMARY KEY (conversation_id, message_id)
);

-- Index for faster message retrieval (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_messages_lookup
ON voltagent_memory_messages(conversation_id, created_at);

-- Index for message role filtering
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_messages_role
ON voltagent_memory_messages(conversation_id, role, created_at);

-- Agent History Table (New Structured Format)
CREATE TABLE IF NOT EXISTS voltagent_memory_agent_history (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT,
    input JSONB,
    output JSONB,
    usage JSONB,
    metadata JSONB,
    user_id TEXT,
    conversation_id TEXT,
    -- Legacy columns for migration compatibility
    key TEXT,
    value JSONB
);

-- Indexes for agent history
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_agent_history_id
ON voltagent_memory_agent_history(id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_agent_history_agent_id
ON voltagent_memory_agent_history(agent_id);

-- Agent History Steps Table
CREATE TABLE IF NOT EXISTS voltagent_memory_agent_history_steps (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL, -- Store the step object as JSONB
    -- Foreign key to history entry
    history_id TEXT NOT NULL,
    agent_id TEXT NOT NULL
);

-- Indexes for faster lookup
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_agent_history_steps_history_id
ON voltagent_memory_agent_history_steps(history_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_agent_history_steps_agent_id
ON voltagent_memory_agent_history_steps(agent_id);

-- Timeline Events Table (New)
CREATE TABLE IF NOT EXISTS voltagent_memory_agent_history_timeline_events (
    id TEXT PRIMARY KEY,
    history_id TEXT NOT NULL,
    agent_id TEXT,
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    status TEXT,
    status_message TEXT,
    level TEXT DEFAULT 'INFO',
    version TEXT,
    parent_event_id TEXT,
    tags JSONB,
    input JSONB,
    output JSONB,
    error JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for timeline events
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_timeline_events_history_id
ON voltagent_memory_agent_history_timeline_events(history_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_timeline_events_agent_id
ON voltagent_memory_agent_history_timeline_events(agent_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_timeline_events_event_type
ON voltagent_memory_agent_history_timeline_events(event_type);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_timeline_events_event_name
ON voltagent_memory_agent_history_timeline_events(event_name);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_timeline_events_parent_event_id
ON voltagent_memory_agent_history_timeline_events(parent_event_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_timeline_events_status
ON voltagent_memory_agent_history_timeline_events(status);

-- Workflow History Table
CREATE TABLE IF NOT EXISTS voltagent_memory_workflow_history (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'error', 'cancelled')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    input JSONB,
    output JSONB,
    metadata JSONB,
    user_id TEXT,
    conversation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Workflow Steps Table
CREATE TABLE IF NOT EXISTS voltagent_memory_workflow_steps (
    id TEXT PRIMARY KEY,
    workflow_history_id TEXT NOT NULL REFERENCES voltagent_memory_workflow_history(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK (step_type IN ('agent', 'func', 'conditional-when', 'parallel-all', 'parallel-race')),
    step_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'error', 'skipped')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    input JSONB,
    output JSONB,
    error_message TEXT,
    agent_execution_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Workflow Timeline Events Table
CREATE TABLE IF NOT EXISTS voltagent_memory_workflow_timeline_events (
    id TEXT PRIMARY KEY,
    workflow_history_id TEXT NOT NULL REFERENCES voltagent_memory_workflow_history(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    status TEXT,
    level TEXT DEFAULT 'INFO',
    input JSONB,
    output JSONB,
    metadata JSONB,
    event_sequence INTEGER,
    trace_id TEXT,
    parent_event_id TEXT,
    status_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for workflow tables
CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_history_workflow_id
ON voltagent_memory_workflow_history(workflow_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_history_status
ON voltagent_memory_workflow_history(status);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_history_start_time
ON voltagent_memory_workflow_history(start_time);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_history_user_id
ON voltagent_memory_workflow_history(user_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_history_conversation_id
ON voltagent_memory_workflow_history(conversation_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_steps_workflow_history_id
ON voltagent_memory_workflow_steps(workflow_history_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_steps_step_index
ON voltagent_memory_workflow_steps(workflow_history_id, step_index);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_timeline_events_workflow_history_id
ON voltagent_memory_workflow_timeline_events(workflow_history_id);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_timeline_events_type
ON voltagent_memory_workflow_timeline_events(type);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_timeline_events_start_time
ON voltagent_memory_workflow_timeline_events(start_time);

CREATE INDEX IF NOT EXISTS idx_voltagent_memory_workflow_timeline_events_sequence
ON voltagent_memory_workflow_timeline_events(event_sequence);

-- Migration Flags Table (Prevents duplicate migrations)
CREATE TABLE IF NOT EXISTS voltagent_memory_conversations_migration_flags (
    id SERIAL PRIMARY KEY,
    migration_type TEXT NOT NULL UNIQUE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    migrated_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Insert fresh installation flags to prevent future migrations
INSERT INTO voltagent_memory_conversations_migration_flags (migration_type, migrated_count, metadata)
VALUES
    ('conversation_schema_migration', 0, '{"fresh_install": true}'::jsonb),
    ('agent_history_migration', 0, '{"fresh_install": true}'::jsonb)
ON CONFLICT (migration_type) DO NOTHING;