# Voltagent Integration

This document describes the integration of Voltagent AI agents with the Telegram bot server.

## Overview

The integration allows users to interact with AI agents through Telegram chat commands. The system supports multiple agent types and maintains conversation context per user.

## Architecture

### Components

1. **VoltagentService** (`src/services/voltagent.service.ts`)
   - Singleton service managing Voltagent instances
   - Handles agent initialization and configuration
   - Processes messages through AI agents

2. **AgentBridgeService** (`src/services/agent-bridge.service.ts`)
   - Bridges Telegram messages with Voltagent agents
   - Manages active agent sessions per user
   - Handles message formatting and response splitting

3. **Enhanced SessionManager** (`src/bot/session.ts`)
   - Extended to support agent conversation data
   - Tracks active agent sessions per user
   - Maintains conversation context

4. **Command Handlers** (`src/handlers/commands.ts`)
   - `/agent <type>` - Start agent conversation
   - `/agents` - List available agents
   - `/agent_stop` - Stop current agent session

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Voltagent Configuration
VOLTAGENT_ENABLED=true
LLM_PROVIDER=openai
LLM_API_KEY=your_openai_api_key_here
LLM_MODEL=gpt-4o-mini
VOLTAGENT_PORT=3141
```

### Supported Providers

- `openai` - OpenAI GPT models
- `google` - Google Gemini models (requires `@ai-sdk/google`)

## Usage

### Starting Agent Conversations

1. **Via Command**: `/agent general` or `/agent code`
2. **Via Menu**: `/agent` (shows inline keyboard with agent options)

### Available Agents

- **general** - General purpose assistant for questions and conversations
- **code** - Programming and development assistant

### Managing Conversations

- **Stop**: `/agent_stop` - Ends the current agent conversation
- **Status**: Active conversations are maintained per user
- **Context**: Messages are processed through the active agent

## Message Flow

1. User sends message to Telegram bot
2. Message handler checks for active agent session
3. If active session exists, message is routed to AgentBridge
4. AgentBridge processes message through Voltagent service
5. AI response is formatted and sent back to user

## Features

- **Session Management**: Per-user conversation tracking
- **Message Formatting**: Automatic code block formatting
- **Long Message Handling**: Automatic splitting of long responses
- **Type Safety**: Full TypeScript support
- **Error Handling**: Graceful fallbacks for API errors

## Implementation Status

✅ **Complete Implementation**
- Dependencies installed and configured
- Service architecture implemented
- Telegram command handlers added
- Session management extended
- Message routing integrated
- Server startup/shutdown handling

⚠️ **Known Issues**
- Dependency version compatibility (zod) may need adjustment
- Requires valid LLM API key for full functionality

## Testing

Run the integration test:
```bash
bun run test-simple.ts
```

## Deployment Notes

1. Set `VOLTAGENT_ENABLED=true` in production
2. Provide valid `LLM_API_KEY`
3. Choose appropriate `LLM_MODEL` for your use case
4. Monitor API usage and costs
5. Consider implementing rate limiting for AI requests

## Architecture Diagram

```
Telegram User
     ↓
Message Handler
     ↓
AgentBridge ← → SessionManager
     ↓
VoltagentService
     ↓
LLM Provider (OpenAI/Google)
     ↓
AI Response → Telegram User
```

## Future Enhancements

- Additional agent types (e.g., image analysis, document processing)
- Conversation history persistence
- Agent switching within conversations  
- Custom agent instructions per user
- Usage analytics and monitoring