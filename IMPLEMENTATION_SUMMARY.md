# CoverageX Chatbot Implementation Summary

## Overview
Successfully transformed the chatbot from a retention conversation simulator to a CoverageX vehicle protection sales assistant with OpenAI function calling integration.

## What Was Changed

### 1. System Prompt (lines 132-179 in index.js)
**Before:** Complex persona simulating an unmotivated employee in retention discussions
**After:** CoverageX sales assistant that:
- Welcomes customers and asks about their vehicle
- Guides through: first name → year → make → model → odometer → state
- Uses tools to fetch vehicle data dynamically
- Presents pricing with incentives (10% online, extra 10% phone)
- Handles unsupported states gracefully

### 2. OpenAI Function Calling Tools (lines 182-221)
**New Implementation:**
- `get_vehicle_makes(year)` - Fetches available makes for a year from CoverageX API
- `get_vehicle_models(year, make)` - Fetches models for year/make combination
- Tools are automatically invoked by AI when customer provides vehicle info

### 3. CoverageX API Integration (lines 56-79)
**New Functions:**
```javascript
getMakesForYear(year)
// GET https://coveragex.com/api/years/{year}/makes?ref={ref}
// Returns: { makes: ["Acura", "Alfa Romeo", ...] }

getModelsForMake(year, make)
// GET https://coveragex.com/api/years/{year}/makes/{make}/models?ref={ref}
// Returns: { models: ["Accord", "Civic", ...], ref: "..." }
```

### 4. Tool Execution Loop (lines 254-327)
**New Multi-Turn Processing:**
1. OpenAI decides to call tools based on conversation
2. Execute tool functions (API calls to CoverageX)
3. Feed results back to OpenAI
4. AI generates natural language response with vehicle data
5. Repeat if more tool calls needed
6. Send final response to customer

### 5. Conversation History Enhancement (lines 25-49)
**Updated to support:**
- `tool_calls` - Store when AI requests function execution
- `tool_call_id` - Link tool responses to requests
- `name` - Function name for tool messages
- Increased limit from 10 to 20 messages (handle tool call chains)

### 6. Environment Configuration
**New Variables:**
```env
COVERAGEX_API_REF=1f0aad9b-1372-636e-bab7-000d3a8ab96a
MAX_TOKENS=1000  # Increased from 500 for function calling
```

## Sales Flow Implementation

Based on the requirements from Lakmal Antony, the bot implements:

### Information Collection
1. **First Name** - Personalization
2. **Year** - Triggers make lookup via API
3. **Make** - Selected from API results, triggers model lookup
4. **Model** - Selected from API results
5. **Odometer** - Approximate reading (±500 miles acceptable)
6. **State** - Registration state for pricing

### Pricing & Coverage Strategy

**Three Protection Tiers:**

1. **Essential - $99/month**
   - Roadside assistance (24/7, towing up to 100 miles)
   - Basic emergency services (jump-start, flat tire, lockout, fuel)
   - Trip interruption coverage ($500)
   - Rental car reimbursement ($50/day, up to 5 days)

2. **Preferred - $109/month (RECOMMENDED)**
   - Everything in Essential PLUS
   - Engine & transmission coverage (major components)
   - Electrical, A/C, steering & suspension
   - Enhanced trip interruption ($1,000)
   - Better rental car ($75/day, up to 7 days)
   - Transferable coverage (adds resale value)

3. **Premium - $129/month**
   - Everything in Preferred PLUS
   - Technology & navigation systems
   - Advanced driver assistance systems (ADAS)
   - Hybrid/electric vehicle components
   - Tire & wheel, key fob, glass protection
   - Paint & dent protection, windshield repair
   - Maximum trip interruption ($2,000)
   - Premium rental car ($100/day, up to 10 days)

**Discount Structure:**
- Base prices: $99 / $109 / $129 per month
- Online discount: 10% off → $89.10 / $98.10 / $116.10
- Phone discount: Additional 10% → $80.19 / $88.29 / $104.49
- 2-year prepayment: Even deeper discounts
- Urgency messaging: "Limited time - next 24 hours"
- Upsell strategy: Show Premium at discounted price vs Essential at full price

**Key Benefits (All Plans):**
- 24/7 Roadside Assistance
- No deductible on roadside services
- Nationwide coverage (all 50 states)
- Claims processed in 24-48 hours
- Choose your own repair shop
- Month-to-month plans (no long-term contracts)
- Cancel anytime
- Coverage starts immediately

**What's NOT Covered:**
- Pre-existing conditions
- Regular maintenance (oil changes, brake pads, filters)
- Wear and tear items (wiper blades, light bulbs)
- Cosmetic damage not affecting function
- Modifications or aftermarket parts
- Racing or commercial use damage
- Damage from neglect or lack of maintenance

### State Handling
Unsupported states receive:
> "We would love to have you as a customer, however, unfortunately at this time we cannot provide protection in your state. Can we follow up with you when this feature becomes available?"

## API Testing Results

### Health Endpoint
```bash
curl http://localhost:3004/health
# ✓ Returns: { status: "healthy", timestamp: "..." }
```

### CoverageX Makes API
```bash
curl "https://coveragex.com/api/years/2023/makes?ref=..."
# ✓ Returns 46 vehicle makes (Acura through Volvo)
```

### CoverageX Models API
```bash
curl "https://coveragex.com/api/years/2023/makes/Honda/models?ref=..."
# ✓ Returns 10 Honda models (Accord, Civic, CR-V, etc.)
```

## Key Features

### 1. Dynamic Vehicle Data Lookup
- AI automatically calls APIs when year/make are mentioned
- No hardcoded vehicle lists
- Always up-to-date with CoverageX inventory

### 2. Natural Conversation Flow
- Not form-like or robotic
- AI decides when to use tools based on context
- Can handle "I have a 2023 Honda Civic" in one message

### 3. Conversation Memory
- Preserves entire tool call history
- Maintains context across 20 messages
- Remembers customer's name and vehicle details

### 4. Error Handling
- API errors are caught and returned as JSON error responses
- Tool failures don't crash the bot
- Graceful degradation if APIs are unavailable

## Files Modified

1. **index.js** - Complete rewrite of core logic
   - Added CoverageX API functions
   - Implemented OpenAI function calling
   - Updated conversation history storage
   - New system prompt

2. **.env** - Added CoverageX configuration
   - `COVERAGEX_API_REF`
   - Updated `MAX_TOKENS` to 1000

3. **CLAUDE.md** - Updated documentation
   - New architecture explanation
   - OpenAI function calling flow
   - CoverageX API integration details
   - Sales flow documentation

## Next Steps (Not Implemented)

### Recommended Enhancements:
1. **Persistent Storage** - Move conversation history to Redis/PostgreSQL
2. **Pricing API** - Integrate actual quote generation with pricing
3. **State Validation** - Check supported states against database
4. **Phone Number Display** - Add sales team phone number to prompts
5. **Quote Summary** - Generate formatted quote with all details
6. **Lead Capture** - Store customer info even if they don't complete purchase
7. **Analytics** - Track conversion funnel (year → make → model → quote → purchase)
8. **A/B Testing** - Test different incentive messaging
9. **Multi-Vehicle Support** - Allow quotes for multiple vehicles
10. **VIN Lookup** - Add third tool for VIN-based vehicle identification

### Production Readiness:
- [ ] Add rate limiting on webhook endpoint
- [ ] Implement request authentication beyond Chatwoot structure
- [ ] Set up monitoring/alerting for API failures
- [ ] Add unit tests for tool functions
- [ ] Load test with concurrent conversations
- [ ] Set up PM2 or similar process manager
- [ ] Configure nginx reverse proxy with SSL
- [ ] Set up log aggregation (ELK stack or similar)
- [ ] Add Sentry or similar error tracking
- [ ] Document runbook for common issues

## Business Logic Implemented

Per requirements from email thread:

✅ Start with first name collection
✅ Ask for year/make/model (not VIN or license plate per latest email)
✅ Use API to get makes and models
✅ Accept approximate odometer readings
✅ Collect state information
✅ Mention online and phone discounts
✅ Create urgency with limited-time messaging
✅ Handle unsupported states with follow-up option
✅ Encourage calling sales team for additional discounts

## Cost Considerations

### OpenAI API Usage:
- Function calling requires multiple completions per conversation turn
- Example: User says "2023 Honda Civic"
  1. Initial completion identifies tool need → 1 API call
  2. Execute `get_vehicle_makes` → No OpenAI cost
  3. Second completion with makes data → 1 API call
  4. Execute `get_vehicle_models` → No OpenAI cost
  5. Third completion with models data → 1 API call
  6. **Total: 3 OpenAI API calls for one user message**

- Recommend monitoring costs and setting budget alerts
- Consider caching common year/make combinations
- Could implement rate limiting per user

### CoverageX API:
- No authentication or rate limits mentioned
- Monitor for any usage restrictions
- Consider caching responses (vehicles don't change frequently)

## Testing Checklist

✅ Server starts successfully
✅ Health endpoint responds
✅ CoverageX makes API returns data
✅ CoverageX models API returns data
✅ Conversation history stores tool metadata
✅ Environment variables loaded correctly

⚠️ Not tested (requires Chatwoot):
- End-to-end conversation flow
- Tool calling in live conversation
- Message sending to Chatwoot
- Human agent detection
- Conversation state management

## Support & Troubleshooting

### Common Issues:

**Server won't start:**
- Check `.env` file exists with required variables
- Verify `npm install` completed successfully
- Check port 3004 is not already in use

**Function calling not working:**
- Verify OpenAI API key has access to gpt-4o-mini
- Check function definitions match expected schema
- Review logs for tool call execution errors

**CoverageX API errors:**
- Verify `COVERAGEX_API_REF` is correct
- Check network connectivity to coveragex.com
- Look for rate limiting or authentication changes

**Conversation history lost:**
- Expected behavior on restart (in-memory storage)
- Implement Redis/DB for persistence if needed

### Debug Mode:
The code includes extensive logging with request IDs:
```
[cw_1234567890_abc] Generating response using LLM with tools
[cw_1234567890_abc] Processing 1 tool call(s)
[cw_1234567890_abc] Calling function: get_vehicle_makes with args: {"year":"2023"}
[cw_1234567890_abc] Function get_vehicle_makes response length: 456 chars
```

Search logs by request ID to trace full conversation flow.

## Conclusion

The chatbot has been successfully transformed into a CoverageX sales assistant with:
- Dynamic vehicle data lookup via OpenAI function calling
- Natural, conversational quote flow
- Pricing incentives to drive conversions
- Proper error handling and logging

Ready for integration with Chatwoot webhook and testing with real customers.
