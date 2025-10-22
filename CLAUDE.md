# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Node.js chatbot that integrates Chatwoot with OpenAI to provide intelligent sales assistance for CoverageX vehicle protection coverage. The bot uses OpenAI function calling to dynamically fetch vehicle data, guides customers through a quote process, and encourages purchase with incentives.

## Commands

### Development
```bash
npm run dev          # Run with nodemon (auto-reload on file changes)
npm start           # Run in production mode
```

### Testing
There are currently no automated tests in this project.

## Architecture

### Single-File Application
The entire application is contained in `index.js` (430 lines). This is a simple Express.js server with no modular architecture.

### Core Components

**Webhook Handler** (`POST /api/chatwoot`):
- Receives Chatwoot webhook events
- Immediately acknowledges (200) then processes asynchronously
- Filters messages: only responds to incoming user messages OR outgoing from sender ID 1
- Skips responses when conversation is assigned to a human agent
- Uses OpenAI function calling to fetch vehicle data dynamically
- Handles multi-turn tool execution loop
- Sends responses back via Chatwoot API

**Conversation History** (in-memory):
- Stored in `conversationHistory` object (not persistent)
- Keeps last 20 messages per conversation (increased for tool calls)
- Each message includes: role, content, timestamp, and optional tool call metadata
- Properly stores tool calls, tool responses, and assistant messages
- Lost on server restart

**OpenAI Function Calling Tools** (lines 182-221):
Two tools defined for vehicle data lookup:
1. `get_vehicle_makes(year)` - Fetches all available makes for a given year
2. `get_vehicle_models(year, make)` - Fetches all models for a year/make combination

**CoverageX API Integration** (lines 56-79):
- Base URL: `https://coveragex.com/api`
- `getMakesForYear(year)` - GET `/years/{year}/makes?ref={ref}`
- `getModelsForMake(year, make)` - GET `/years/{year}/makes/{make}/models?ref={ref}`
- Uses API reference token from environment

**System Prompt** (lines 132-179):
- CoverageX sales assistant persona
- Guides customers through: first name → year → make → model → odometer → state
- Instructs AI to use tools when year/make provided
- Includes pricing strategy (10% online, additional 10% phone)
- Handles state coverage and unsupported states
- Override via `SYSTEM_PROMPT` environment variable

**Response Flow with Function Calling**:
1. Webhook received → immediate 200 response
2. Validate message type and agent assignment
3. Retrieve conversation history (last 20 messages, including tool calls)
4. Build messages array: system prompt + history + current message
5. Call OpenAI API with tools
6. **Tool Execution Loop** (lines 254-327):
   - If assistant requests tool calls, execute them
   - Store assistant message with tool_calls
   - Execute each function (get_vehicle_makes or get_vehicle_models)
   - Store tool responses with tool_call_id
   - Call OpenAI again with tool results
   - Repeat until no more tool calls
7. Store final assistant response
8. Send to Chatwoot via API
9. Optionally set conversation status to "open"
10. Log interaction if enabled

### Key Behavioral Logic

**Message Filtering** (lines 70-78):
- Only processes `message_created` events
- Responds to incoming messages OR outgoing from sender ID 1
- Ignores all other message types

**Agent Assignment Detection** (lines 81-84):
- Checks `conversation.meta.assignee`
- Stops responding when human agent is assigned
- This prevents bot/human conflicts

**Asynchronous Processing**:
- Returns 200 immediately to Chatwoot
- Processes OpenAI request after response sent
- Errors in processing don't affect webhook acknowledgment

## Environment Configuration

Required variables:
- `OPENAI_API_KEY` - OpenAI API key
- `CHATWOOT_API_KEY` - Chatwoot API access token
- `CHATWOOT_BASE_URL` - Chatwoot instance URL

Optional (with defaults):
- `COVERAGEX_API_REF` - Default: `1f0aad9b-1372-636e-bab7-000d3a8ab96a` (API reference token)
- `SYSTEM_PROMPT` - Default: CoverageX sales assistant prompt in index.js
- `OPENAI_MODEL` - Default: `gpt-4o-mini`
- `TEMPERATURE` - Default: `0.7`
- `MAX_TOKENS` - Default: `1000` (increased for function calling)
- `PORT` - Default: `3004`
- `ENABLE_LOGGING` - Default: `true` (saves to `logs/YYYY-MM-DD.jsonl`)
- `AUTO_OPEN_CONVERSATION` - Default: `true`

## Important Technical Details

### Conversation History Limitations
- **Not persistent** - stored in memory only
- **Lost on restart** - no database or file persistence
- **20 message limit** - only recent context retained (increased to handle tool calls)
- **Per conversation** - indexed by `conversation.id`
- **Tool call metadata** - stores tool_calls, tool_call_id, and name for proper function calling flow

### Logging
When enabled, creates `logs/YYYY-MM-DD.jsonl` files with:
- timestamp, requestId, conversationId
- userMessage, aiResponse
- processingTime

### API Integration

**Chatwoot REST API v1:**
- `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages` - Send messages
- `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/toggle_status` - Update status

**CoverageX API:**
- Base: `https://coveragex.com/api`
- `GET /years/{year}/makes?ref={ref}` - Get all makes for a year
- `GET /years/{year}/makes/{make}/models?ref={ref}` - Get all models for year/make
- No authentication required (uses ref parameter)
- Returns JSON arrays of vehicle data

### OpenAI Function Calling Architecture
The bot uses OpenAI's function calling feature to dynamically fetch vehicle data:
1. AI decides when to call tools based on conversation context
2. When year is mentioned, calls `get_vehicle_makes`
3. When year+make are mentioned, calls `get_vehicle_models`
4. Multiple tool calls can occur in sequence
5. Tool responses are fed back to the AI for natural language presentation
6. Conversation history preserves entire tool call chain

## Chatwoot Webhook Setup

1. Settings → Integrations → Webhooks
2. URL: `http://your-server:3004/api/chatwoot`
3. Events: Select `message_created`

## CoverageX Sales Flow

The bot guides customers through this sequence:
1. **Welcome** - Immediately ask about their vehicle
2. **First Name** - Personalize the conversation
3. **Year** - Trigger `get_vehicle_makes` tool
4. **Make** - Present options from tool results
5. **Model** - Trigger `get_vehicle_models` tool, present options
6. **Odometer** - Accept approximate (±500 miles)
7. **State** - Registration state (determines pricing)
8. **Quote** - Present pricing with incentives
9. **Close** - Encourage purchase (10% online, extra 10% phone)

## Pricing & Coverage Details

### Three Protection Tiers:

**Essential Plan - $99/month**
- Roadside assistance, towing, basic emergency services
- Trip interruption coverage ($500)
- Rental car reimbursement ($50/day, 5 days)

**Preferred Plan - $109/month (MOST POPULAR)**
- Everything in Essential
- Engine & transmission coverage
- Electrical, A/C, steering & suspension
- Trip interruption ($1,000)
- Rental car ($75/day, 7 days)
- Transferable coverage

**Premium Plan - $129/month**
- Everything in Preferred
- Technology & navigation systems
- ADAS, hybrid/electric components
- Tire & wheel protection
- Key fob, glass, paint & dent
- Trip interruption ($2,000)
- Rental car ($100/day, 10 days)

### Pricing Strategy (from requirements):

- Base prices: $99, $109, $129/month
- Online discount: 10% off (e.g., Preferred = $98.10/month)
- Phone discount: Additional 10% (e.g., Preferred = $88.29/month)
- Upfront 2-year payment: Additional savings
- Limited-time urgency messaging
- Upsell strategy: Premium at discounted price vs Essential at full price
- Recommend Preferred as "most popular" and "best value"

## Deployment Considerations

- Use PM2 or similar for process management
- Consider external conversation history storage (Redis/database) for production
- No HTTPS built-in - use reverse proxy (nginx)
- No rate limiting implemented
- No authentication on webhook endpoint beyond Chatwoot's event structure
- CoverageX API has no rate limits documented - monitor usage
- Function calling increases OpenAI API calls (multiple completions per conversation turn)
