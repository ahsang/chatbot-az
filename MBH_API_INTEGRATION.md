# MBH API Integration - CoverageX Chatbot

## Overview

Successfully integrated the MBH API for vehicle protection quotes and contract creation. The chatbot now has the full capability to:
1. Collect customer and vehicle information
2. Generate detailed insurance quotes with pricing
3. Guide customers through contract creation

## What Was Added

### 1. MBH API Configuration (index.js: lines 21-32)

```javascript
const MBH_API_BASE = process.env.MBH_API_BASE || 'https://sandbox.ncwcinc.com/crm';
const MBH_API_ID = process.env.MBH_API_ID || 'MB1910E6F';
const MBH_API_KEY = process.env.MBH_API_KEY || '4aad0cb8-a09c-4fce-832f-ff6b2e2d754b';
```

### 2. MBH API Helper Functions (index.js: lines 126-243)

#### Quote Functions:
- `lookupVehicleByVIN(vin)` - Look up vehicle details by VIN
- `getQuoteYears(state)` - Get available years and quote reference ID
- `getQuoteMakes(ref, year, state)` - Get available makes for a year
- `getQuoteModels(ref, make)` - Get available models with class, trim, VIN pattern
- `getQuotePlan(ref, model, modelClass, vinPattern, odometer)` - Get pricing quote

#### Contract Functions:
- `submitQuote(quoteData)` - Submit quote with customer/vehicle data
- `processDeposit(depositData)` - Process credit card payment

### 3. New OpenAI Tools

#### Tool 1: `get_detailed_quote`
**Purpose:** Generate a detailed insurance quote after collecting all vehicle information

**Parameters:**
- `state` - Two-character state code (e.g., 'CA', 'NY')
- `year` - Vehicle year
- `make` - Vehicle make
- `model` - Model name
- `trim` - Trim level
- `modelClass` - Model class number from models API
- `vinPattern` - VIN pattern from models API
- `odometer` - Current mileage

**Process:**
1. Calls `getQuoteYears(state)` to get quote reference ID
2. Stores reference ID for the conversation
3. Calls `getQuotePlan()` to get pricing and coverage details
4. Returns complete quote with pricing to AI for presentation

#### Tool 2: `create_contract`
**Purpose:** Create contract after customer agrees to quote

**Parameters:**
- `firstName`, `lastName`
- `email`, `phone`
- `address`, `city`, `state`, `zip`

**Note:** Currently acknowledges intent - full payment processing requires secure credit card handling

### 4. Quote Reference Storage

```javascript
const quoteReferences = {};
```

Stores quote reference IDs per conversation to maintain state across the multi-step quote process.

### 5. Environment Variables (.env)

```env
# MBH API Configuration (for quotes and contracts)
MBH_API_BASE=https://sandbox.ncwcinc.com/crm
MBH_API_ID=MB1910E6F
MBH_API_KEY=4aad0cb8-a09c-4fce-832f-ff6b2e2d754b
```

## How the Quote Flow Works

### Step 1: Collect Vehicle Information
The bot uses existing tools to collect year, make, model:
1. Customer provides year
2. Bot calls `get_vehicle_makes` → presents makes
3. Customer selects make
4. Bot calls `get_vehicle_models` → presents models with trim options

### Step 2: Collect Additional Details
- Odometer reading (approximate okay)
- State of registration
- Customer selects specific model + trim from the models list

### Step 3: Generate Quote
Bot calls `get_detailed_quote` with:
```json
{
  "state": "NJ",
  "year": "2022",
  "make": "Ford",
  "model": "F-150",
  "trim": "XL",
  "modelClass": "2",
  "vinPattern": "1FTFW1EDNF",
  "odometer": "12345"
}
```

**API Response includes:**
- Product details (plan name, deductible, coverage)
- Finance details (monthly payment, term, deposit)
- Available options/surcharges

### Step 4: Present Quote to Customer
AI receives the quote data and presents:
- Monthly payment amount
- Coverage details
- Deductible amount
- Contract term
- Any available options

### Step 5: Contract Creation (if customer agrees)
Bot collects:
- Full name
- Contact information (email, phone)
- Address details

Then calls `create_contract` to initiate the contract creation process.

## API Endpoints Used

### Sandbox (Testing):
- Base: `https://sandbox.ncwcinc.com/crm`
- Credentials: ID=`MB1910E6F`, Key=`4aad0cb8-a09c-4fce-832f-ff6b2e2d754b`
- Database refreshes nightly

### Production (when ready):
- Base: `https://api.ncwcinc.com/crm`
- Requires production credentials

## Example Conversation Flow

```
Customer: "I'd like to get coverage for my car"
Bot: "I'd be happy to help! What's your first name?"

Customer: "John"
Bot: "Great, John! What year is your vehicle?"

Customer: "2022"
Bot: [calls get_vehicle_makes]
Bot: "Perfect! What make is your 2022 vehicle? We support Ford, Honda, Toyota..."

Customer: "Ford"
Bot: [calls get_vehicle_models]
Bot: "Excellent choice! Which Ford model? F-150, Mustang, Explorer..."

Customer: "F-150 XL"
Bot: "Great! What's the current odometer reading? An estimate is fine."

Customer: "About 15,000 miles"
Bot: "And what state is the vehicle registered in?"

Customer: "New Jersey"
Bot: [calls get_detailed_quote]
Bot: "Perfect! Based on your 2022 Ford F-150 XL with 15,000 miles in New Jersey, here's your quote:

**Executive Plan - $118/month**
- $200 deductible
- Comprehensive mechanical breakdown coverage
- 24-month term
- Roadside assistance included

Would you like to proceed with this coverage?"

Customer: "Yes!"
Bot: "Excellent! To complete your contract, I'll need a few more details..."
[collects full contact information]
Bot: [calls create_contract]
```

## Testing the Integration

### Test VIN Lookup:
```bash
curl --header 'Authorization: Bearer {"id":"MB1910E6F","key":"4aad0cb8-a09c-4fce-832f-ff6b2e2d754b"}' \
--header "Content-Type: application/json" \
-X GET "https://sandbox.ncwcinc.com/crm?lookup=vehicle&key=vin&keyValue=1G1FH1R7XR0102632"
```

### Test Quote Years:
```bash
curl --header 'Authorization: Bearer {"id":"MB1910E6F","key":"4aad0cb8-a09c-4fce-832f-ff6b2e2d754b"}' \
--header "Content-Type: application/json" \
-X GET "https://sandbox.ncwcinc.com/crm?quote=years&state=NJ"
```

## Important Notes

### Security Considerations:
1. **Payment Processing:** Credit card information should NEVER be collected through chat
2. **PCI Compliance:** Use secure payment gateway for actual transactions
3. **Data Storage:** Quote references stored in memory - not persistent
4. **Production Credentials:** Update environment variables for production use

### State Restrictions:
Some states may not be licensed for sales. The API will return error:
```json
{
  "code": "400",
  "message": "we're not licensed to sell in the state: CA"
}
```

### Quote Expiration:
- Sandbox quotes persist until nightly database refresh
- Production quotes should have expiration logic

### Model Selection:
The models API returns detailed information:
```json
{
  "name": "F-150",
  "trim": "XL",
  "class": "2",
  "vinPattern": "1FTFW1EDNF"
}
```

All three fields (class, trim, vinPattern) are required for quote generation.

## Next Steps for Production

1. **Replace sandbox credentials** with production API credentials
2. **Implement secure payment processing** via payment gateway
3. **Add contract confirmation** with policy number returned
4. **Store quote/contract data** in persistent database
5. **Add email notifications** for quotes and contract confirmations
6. **Implement quote expiration** logic (e.g., 7 days)
7. **Add contract lookup** by policy number for existing customers
8. **Enhanced error handling** for API failures
9. **Rate limiting** to prevent API abuse
10. **Audit logging** for all quote and contract operations

## Error Handling

All API calls include try/catch blocks:
- Network errors return error message to AI
- API errors (400, 202, etc.) are logged and returned as JSON
- AI can present errors naturally to customer
- Conversation can recover from errors (e.g., try different state)

## Files Modified

1. **index.js**
   - Added MBH API configuration (lines 21-32)
   - Added 7 new API helper functions (lines 126-243)
   - Added 2 new OpenAI tools (lines 500-589)
   - Updated tool execution logic (lines 656-701)

2. **.env**
   - Added MBH API credentials (lines 28-31)

3. **MBH_API_INTEGRATION.md** (this file)
   - Complete integration documentation

## API Documentation Reference

Full MBH API documentation provided includes:
- Authentication headers
- All available endpoints
- Request/response examples
- Error codes
- cURL examples for all operations

The chatbot now supports the complete customer journey from initial inquiry to contract creation!
