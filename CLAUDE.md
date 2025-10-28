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
- **Typing Indicator**: Turns ON when processing starts, OFF before sending response
- Uses OpenAI function calling to fetch vehicle data dynamically
- Handles multi-turn tool execution loop
- Sends responses back via Chatwoot API

**Conversation History** (in-memory):
- Stored in `conversationHistory` object (not persistent)
- Keeps last 20 messages per conversation (increased for tool calls)
- Each message includes: role, content, timestamp, and optional tool call metadata
- Properly stores tool calls, tool responses, and assistant messages
- Lost on server restart

**OpenAI Function Calling Tools**:
Three tools defined for the complete quote and contract flow:
1. `get_vehicle_makes(year, state)` - Fetches all available makes for a given year using MBH API
2. `get_vehicle_models(make, state)` - Fetches all models with trim, class, and VIN pattern using MBH API
3. `get_detailed_quote(state, year, make, model, trim, modelClass, vinPattern, odometer)` - Generates real insurance quote with pricing
4. `create_contract(customer info, vin, payment info)` - Creates contract: submits quote, processes deposit, saves to Deal Manager

**MBH API Integration**:
- Base URL: `https://sandbox.ncwcinc.com/crm` (sandbox) or `https://api.ncwcinc.com/crm` (production)
- Authentication: Bearer token with JSON format `{"id":"...", "key":"..."}`
- Quote flow maintains a `ref` (reference ID) throughout the entire process
- `getQuoteYears(state)` - GET `?quote=years&state={state}` - Returns ref + years
- `getQuoteMakes(ref, year)` - GET `?quote=makes&ref={ref}&year={year}` - Returns makes list
- `getQuoteModels(ref, make)` - GET `?quote=models&ref={ref}&make={make}` - Returns models with trim/class/vinPattern
- `getQuotePlan(ref, model, class, vinPattern, odometer)` - GET `?quote=plan&ref={ref}&model={model}&class={class}&vinPattern={vinPattern}&odometer={odometer}` - Returns pricing and product details
- `submitQuote(quoteData)` - PUT `/quote` - Submits customer/vehicle/policy data
- `processDeposit(depositData)` - POST `/deposit` - Processes credit card payment
- `saveContract()` - POST `/dm/save-contract` - Finalizes contract in Deal Manager

**System Prompt** (lines 132-179):
- CoverageX sales assistant persona
- Guides customers through: first name → year → make → model → odometer → state
- Instructs AI to use tools when year/make provided
- Includes pricing strategy (10% online, additional 10% phone)
- Handles state coverage and unsupported states
- Override via `SYSTEM_PROMPT` environment variable

**Typing Indicator Function** (lines 56-85):
- `toggleTypingIndicator(conversation, account, status, requestId)`
- Uses dedicated `CHATWOOT_TYPING_API_KEY` or falls back to `CHATWOOT_API_KEY`
- Logs which API key type is being used (dedicated vs fallback)
- Fails gracefully without disrupting message flow
- Turned ON at start of processing, OFF before sending response, OFF on error

**Response Flow with Function Calling**:
1. Webhook received → immediate 200 response
2. Validate message type and agent assignment
3. **Turn ON typing indicator**
4. Retrieve conversation history (last 20 messages, including tool calls)
5. Build messages array: system prompt + history + current message
6. Call OpenAI API with tools
7. **Tool Execution Loop**:
   - If assistant requests tool calls, execute them
   - Store assistant message with tool_calls
   - Execute each function:
     - `get_vehicle_makes`: Gets years+ref from MBH, then gets makes list, stores ref
     - `get_vehicle_models`: Uses stored ref to get models with trim/class/VIN pattern
     - `get_detailed_quote`: Gets or reuses ref, calls getQuotePlan, stores all quote data
     - `create_contract`: Submits quote → processes deposit → saves contract
   - Store tool responses with tool_call_id
   - Call OpenAI again with tool results
   - Repeat until no more tool calls
8. Store final assistant response
9. **Turn OFF typing indicator**
10. Send to Chatwoot via API
11. Optionally set conversation status to "open"
12. Log interaction if enabled

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
- `MBH_API_ID` - MBH assigned ID for API authentication
- `MBH_API_KEY` - MBH assigned key for API authentication

Optional (with defaults):
- `CHATWOOT_TYPING_API_KEY` - Dedicated API key for typing indicator (falls back to `CHATWOOT_API_KEY` if not set)
- `MBH_API_BASE` - Default: `https://sandbox.ncwcinc.com/crm` (use `https://api.ncwcinc.com/crm` for production)
- `SYSTEM_PROMPT` - Default: CoverageX sales assistant prompt in index.js
- `OPENAI_MODEL` - Default: `gpt-4o-mini`
- `TEMPERATURE` - Default: `0.7`
- `MAX_TOKENS` - Default: `1000` (increased for function calling)
- `PORT` - Default: `3004`
- `ENABLE_LOGGING` - Default: `true` (saves to `logs/YYYY-MM-DD.jsonl`)
- `AUTO_OPEN_CONVERSATION` - Default: `true`

## Important Technical Details

### In-Memory Storage Limitations
**Conversation History:**
- **Not persistent** - stored in memory only
- **Lost on restart** - no database or file persistence
- **20 message limit** - only recent context retained (increased to handle tool calls)
- **Per conversation** - indexed by `conversation.id`
- **Tool call metadata** - stores tool_calls, tool_call_id, and name for proper function calling flow

**Quote Data Storage:**
- `quoteReferences` - Stores MBH API reference IDs per conversation (needed for entire quote flow)
- `quoteData` - Stores vehicle/plan information for contract creation
- Both lost on server restart - consider Redis/database for production

### Logging
When enabled, creates `logs/YYYY-MM-DD.jsonl` files with:
- timestamp, requestId, conversationId
- userMessage, aiResponse
- processingTime

### API Integration

**Chatwoot REST API v1:**
- `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages` - Send messages
- `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/toggle_status` - Update status
- `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/toggle_typing_status` - Typing indicator

**MBH API:**
- Base: `https://sandbox.ncwcinc.com/crm` (sandbox) or `https://api.ncwcinc.com/crm` (production)
- Authentication: Bearer token with JSON format `Bearer {"id":"ID","key":"KEY"}`
- All endpoints use query parameters
- Complete quote flow documented in `api-manual.txt`

### OpenAI Function Calling Architecture
The bot uses OpenAI's function calling feature for the complete quote-to-contract flow:
1. AI decides when to call tools based on conversation context
2. When year+state mentioned, calls `get_vehicle_makes` (internally: getQuoteYears → getQuoteMakes)
3. When make mentioned, calls `get_vehicle_models` (internally: getQuoteModels with stored ref)
4. When all vehicle details collected, calls `get_detailed_quote` (internally: getQuotePlan)
5. When customer agrees and provides payment, calls `create_contract` (internally: submitQuote → processDeposit → saveContract)
6. Multiple tool calls can occur in sequence
7. Tool responses are fed back to the AI for natural language presentation
8. Conversation history preserves entire tool call chain

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
