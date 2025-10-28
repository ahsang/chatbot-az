require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3004;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// CoverageX API Configuration
const COVERAGEX_API_BASE = 'https://coveragex.com/api';
const COVERAGEX_API_REF = process.env.COVERAGEX_API_REF || '1f0aad9b-1372-636e-bab7-000d3a8ab96a';

// MBH API Configuration
const MBH_API_BASE = process.env.MBH_API_BASE || 'https://sandbox.ncwcinc.com/crm';
const MBH_API_ID = process.env.MBH_API_ID || 'MB1910E6F';
const MBH_API_KEY = process.env.MBH_API_KEY || '4aad0cb8-a09c-4fce-832f-ff6b2e2d754b';

// Helper function to create MBH API headers
function getMBHHeaders() {
  return {
    'Authorization': `Bearer {"id":"${MBH_API_ID}","key":"${MBH_API_KEY}"}`,
    'Content-Type': 'application/json'
  };
}

// In-memory conversation history store
const conversationHistory = {};

// Store message in conversation history
const storeMessageInHistory = (conversationId, role, content, toolCalls = null, toolCallId = null, name = null) => {
  if (!conversationId) return;

  if (!conversationHistory[conversationId]) {
    conversationHistory[conversationId] = [];
  }

  const message = {
    role,
    content,
    timestamp: new Date().toISOString()
  };

  // Add tool-related fields if present
  if (toolCalls) message.tool_calls = toolCalls;
  if (toolCallId) message.tool_call_id = toolCallId;
  if (name) message.name = name;

  conversationHistory[conversationId].push(message);

  // Keep only the last 20 messages (increased for tool calls)
  if (conversationHistory[conversationId].length > 20) {
    conversationHistory[conversationId].shift();
  }
};

// Get conversation history
const getConversationHistory = (conversationId) => {
  return conversationHistory[conversationId] || [];
};

// Function to toggle typing indicator in Chatwoot
async function toggleTypingIndicator(conversation, account, status, requestId) {
  if (!conversation?.id || !account?.id) {
    console.log(`[${requestId}] Cannot toggle typing indicator: missing conversation or account data`);
    return;
  }

  // Use dedicated typing indicator API key, fallback to main API key if not set
  const chatwootApiKey = process.env.CHATWOOT_TYPING_API_KEY || process.env.CHATWOOT_API_KEY;
  if (!chatwootApiKey) {
    console.log(`[${requestId}] Cannot toggle typing indicator: missing API key`);
    return;
  }

  try {
    const typingUrl = `${process.env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com'}/api/v1/accounts/${account.id}/conversations/${conversation.id}/toggle_typing_status`;
    console.log(`[${requestId}] Turning ${status} typing indicator (using ${process.env.CHATWOOT_TYPING_API_KEY ? 'dedicated' : 'fallback'} API key)`);
    await axios.post(typingUrl, {
      typing_status: status
    }, {
      headers: {
        'Content-Type': 'application/json',
        'api_access_token': chatwootApiKey
      }
    });
    console.log(`[${requestId}] Typing indicator turned ${status}`);
  } catch (error) {
    console.error(`[${requestId}] Error toggling typing indicator:`, error.message);
    // Continue processing even if typing indicator fails
  }
}

// MBH API Functions for Quotes and Contracts

// Store quote references and data per conversation
const quoteReferences = {};
const quoteData = {}; // Stores vehicle/plan info for contract creation

async function lookupVehicleByVIN(vin) {
  try {
    const response = await axios.get(`${MBH_API_BASE}`, {
      params: {
        lookup: 'vehicle',
        key: 'vin',
        keyValue: vin
      },
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error looking up VIN ${vin}:`, error.message);
    throw error;
  }
}

async function getQuoteYears(state) {
  try {
    const response = await axios.get(`${MBH_API_BASE}`, {
      params: {
        quote: 'years',
        state: state
      },
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error getting quote years for state ${state}:`, error.message);
    throw error;
  }
}

async function getQuoteMakes(ref, year, state = null) {
  try {
    const params = {
      quote: 'makes',
      ref: ref,
      year: year
    };
    if (state) params.state = state;

    const response = await axios.get(`${MBH_API_BASE}`, {
      params: params,
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error getting quote makes:`, error.message);
    throw error;
  }
}

async function getQuoteModels(ref, make) {
  try {
    const response = await axios.get(`${MBH_API_BASE}`, {
      params: {
        quote: 'models',
        ref: ref,
        make: make
      },
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error getting quote models:`, error.message);
    throw error;
  }
}

async function getQuotePlan(ref, model, modelClass, vinPattern, odometer) {
  try {
    const response = await axios.get(`${MBH_API_BASE}`, {
      params: {
        quote: 'plan',
        ref: ref,
        model: model,
        class: modelClass,
        vinPattern: vinPattern,
        odometer: odometer
      },
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error getting quote plan:`, error.message);
    throw error;
  }
}

async function submitQuote(quoteData) {
  try {
    const response = await axios.put(`${MBH_API_BASE}/quote`, quoteData, {
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error submitting quote:`, error.message);
    throw error;
  }
}

async function processDeposit(depositData) {
  try {
    const response = await axios.post(`${MBH_API_BASE}/deposit`, depositData, {
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error processing deposit:`, error.message);
    throw error;
  }
}

async function saveContract() {
  try {
    // Note: Using /dm endpoint for save-contract as per API manual
    const dmEndpoint = MBH_API_BASE.replace('/crm', '/dm');
    const response = await axios.post(`${dmEndpoint}/save-contract`, {}, {
      headers: getMBHHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`Error saving contract:`, error.message);
    throw error;
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main Chatwoot webhook handler
app.post('/api/chatwoot', async (req, res) => {
  const requestId = `cw_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const startTime = Date.now();
  
  console.log(`[${requestId}] Chatwoot webhook request received`);
  
  // Send immediate acknowledgment to Chatwoot
  res.status(200).json({ success: true, message: 'Webhook received, processing asynchronously' });
  
  try {
    const { event, message_type, content, conversation, account } = req.body;
    
    console.log(`[${requestId}] Processing ${event} event, message type: ${message_type}`);
    
    // Only respond to incoming user messages OR outgoing messages from sender ID 1
    const shouldRespond = event === 'message_created' && (
      message_type === 'incoming' || 
      (message_type === 'outgoing' && conversation?.sender?.id === 1)
    );
    
    if (!shouldRespond) {
      console.log(`[${requestId}] Skipping message: ${event}, ${message_type}, sender: ${conversation?.sender?.id}`);
      return;
    }
    
    // Check if conversation is assigned to an agent
    if (conversation?.meta?.assignee) {
      console.log(`[${requestId}] Conversation is assigned to agent: ${conversation.meta.assignee.name}`);
      return; // Don't respond if conversation is assigned to a human agent
    }
    
    console.log(`[${requestId}] Processing user message: "${content?.substring(0, 50)}${content?.length > 50 ? '...' : ''}"`);

    // Turn ON typing indicator
    await toggleTypingIndicator(conversation, account, 'on', requestId);

    // Get conversation history
    const history = getConversationHistory(conversation?.id);
    console.log(`[${requestId}] Retrieved ${history.length} previous messages for conversation ${conversation?.id}`);
    
    // Store the current user message in history
    storeMessageInHistory(conversation?.id, 'user', content);
    
    // Get system prompt from environment variable or use default
    const systemPrompt = process.env.SYSTEM_PROMPT || `You are a friendly and professional CoverageX sales assistant. Your goal is to help potential customers get comprehensive vehicle protection coverage by guiding them through a conversational quote process.

## Your Objectives:
1. Welcome customers warmly and immediately engage them about their vehicle
2. Collect necessary information: First name, Year, Make, Model, Odometer reading (approximate is fine), and State
3. Guide them through the quote process naturally and conversationally
4. Educate them about CoverageX coverage and benefits
5. Present pricing options and encourage purchase with incentives

## CoverageX Protection Plans - Complete Details

We offer THREE comprehensive protection packages:

### ESSENTIAL PLAN - $99/month
**Coverage:**
- Roadside Assistance (24/7)
- Towing Service (up to 100 miles)
- Battery Jump-Start
- Flat Tire Assistance
- Lockout Service
- Fuel Delivery
- Trip Interruption Coverage (up to $500)
- Rental Car Reimbursement ($50/day, up to 5 days)

**Best For:** Customers who want basic roadside peace of mind and emergency coverage

### PREFERRED PLAN - $109/month (MOST POPULAR)
**Everything in Essential, PLUS:**
- Extended Mechanical Breakdown Protection
- Engine Coverage (major components)
- Transmission Coverage (major components)
- Electrical System Coverage
- Air Conditioning Coverage
- Steering & Suspension
- Rental Car Reimbursement ($75/day, up to 7 days)
- Trip Interruption Coverage (up to $1,000)
- Transferable Coverage (adds resale value)

**Best For:** Customers who want comprehensive protection against expensive mechanical failures

### PREMIUM PLAN - $129/month (MAXIMUM PROTECTION)
**Everything in Preferred, PLUS:**
- Comprehensive Mechanical Breakdown Protection
- Technology & Navigation Systems
- Advanced Driver Assistance Systems (ADAS)
- Hybrid/Electric Vehicle Components
- Turbocharger & Supercharger
- Seals & Gaskets
- Rental Car Reimbursement ($100/day, up to 10 days)
- Trip Interruption Coverage (up to $2,000)
- Tire & Wheel Protection
- Key Fob Replacement
- Glass Repair Coverage
- Paint & Dent Protection
- Windshield Repair

**Best For:** Customers who want total peace of mind and protection for modern vehicle technology

## Key Benefits Across All Plans:
- 24/7 Roadside Assistance
- No Deductible on roadside services
- Nationwide Coverage (all 50 states)
- Claims Processed in 24-48 hours
- Choose Your Own Repair Shop
- Month-to-Month Plans (no long-term contracts)
- Cancel Anytime
- Coverage starts immediately

## What's NOT Covered:
- Pre-existing conditions
- Regular maintenance (oil changes, brake pads, filters)
- Wear and tear items (wiper blades, light bulbs)
- Cosmetic damage not affecting function
- Modifications or aftermarket parts
- Racing or commercial use damage
- Damage from neglect or lack of maintenance

## Information Collection Flow:
1. Start by asking for their first name to personalize the conversation
2. Ask what car they drive - get the year first
3. Once you have the year, use the get_vehicle_makes tool to fetch available makes
4. After they provide a make, use the get_vehicle_models tool to get available models
5. Ask for odometer reading (tell them an approximate is fine, just to keep things moving)
6. Ask what state they live in and what state the vehicle is registered in

## Tools Available:
- get_vehicle_makes: Call this with a year to get all available vehicle makes for that year
- get_vehicle_models: Call this with year and make to get all available models

## Important Guidelines:
- Be conversational and friendly, not robotic
- If they provide vehicle info in one message (like "2023 Honda Civic"), acknowledge it and use tools to validate
- Keep responses concise and focused on moving toward the quote
- When you have year/make/model, compliment their choice
- For odometer, accept approximations within 500 miles
- Reassure them this is quick and easy
- Educate about coverage - explain what's covered in simple terms
- Focus on peace of mind and protection from unexpected repair costs

## Pricing Presentation (After Collecting All Info):

Present all three plans with DISCOUNTED prices:

**Essential Plan:**
- Regular: $99/month
- Online Discount (10%): $89.10/month
- Call for Extra Savings: "Call now and save an additional 10% - just $80.19/month!"

**Preferred Plan (RECOMMENDED):**
- Regular: $109/month
- Online Discount (10%): $98.10/month
- Call for Extra Savings: "Call now and save an additional 10% - just $88.29/month!"

**Premium Plan:**
- Regular: $129/month
- Online Discount (10%): $116.10/month
- Call for Extra Savings: "Call now and save an additional 10% - just $104.49/month!"

## Additional Savings Options:
- **2-Year Prepayment:** Mention that paying for 2 years upfront unlocks even deeper discounts
- **Limited Time Offers:** Create urgency with "This discount is available for the next 24 hours"
- **Upsell Strategy:** Show Premium at discounted price vs Essential at full price to make upgrade attractive

## Sales Strategy:
1. After collecting all info, present all three plans briefly
2. Recommend Preferred Plan as "most popular" and "best value"
3. Highlight what they'd be missing with Essential (expensive mechanical repairs)
4. Emphasize Premium for newer cars with technology features
5. Always mention phone discount: "Call our team at 1-800-258-3413 to unlock the deepest savings"
6. If hesitant, remind them: "No long-term contract - cancel anytime"

## State Coverage:
- If a state is not supported, say: "We would love to have you as a customer, however, unfortunately at this time we cannot provide protection in your state. Can we follow up with you when this feature becomes available?"

## Example Quote Presentation:
"Great! Based on your 2023 Honda Civic with about 25,000 miles in California, here are your protection options:

Essential Plan: Roadside assistance and basic coverage - $89.10/month (10% online discount)

Preferred Plan (Most Popular): Everything in Essential PLUS engine, transmission, and major mechanical coverage - $98.10/month (10% online discount)

Premium Plan: Maximum protection including all technology, hybrid systems, and comprehensive coverage - $116.10/month (10% online discount)

Want to save even more? Call our team now and get an ADDITIONAL 10% off! That brings the Preferred Plan down to just $88.29/month.

Which plan gives you the peace of mind you're looking for?"

## Tone:
- Friendly, helpful, and professional
- Enthusiastic about protecting their vehicle
- Educational without being pushy
- Clear and concise
- Focus on benefits and peace of mind
- Use customer's first name once you have it
- Create urgency without pressure

Remember: Your goal is to educate, build value, and guide them to purchase with confidence. Most customers choose Preferred Plan - it's the sweet spot for comprehensive protection at a great price!
DO NOT ANSWER ABOUT ANYTHING ELSE OTHER THAN WHAT IS STATED ABOVE, YOUR JOB IS TO GET THE USER TOWARDS BUYING COVERAGE
Alsways keep your responses less than 150 words
`;
    
    // Define OpenAI tools for function calling
    const tools = [
      {
        type: "function",
        function: {
          name: "get_vehicle_makes",
          description: "Get all available vehicle makes for a specific year. Use this when the customer provides a year and state. This uses the MBH API quote flow.",
          parameters: {
            type: "object",
            properties: {
              year: {
                type: "string",
                description: "The vehicle year (e.g., '2023', '2022')"
              },
              state: {
                type: "string",
                description: "The customer's state (2-character code, e.g., 'CA', 'NY', 'TX'). Required for MBH API."
              }
            },
            required: ["year", "state"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_vehicle_models",
          description: "Get all available models for a specific vehicle make. Use this after the customer provides make. Returns model name, trim, class, and VIN pattern. This uses the MBH API quote flow.",
          parameters: {
            type: "object",
            properties: {
              make: {
                type: "string",
                description: "The vehicle make (e.g., 'Honda', 'Toyota', 'Ford')"
              },
              state: {
                type: "string",
                description: "The customer's state (2-character code). Needed as fallback if no active quote reference exists."
              }
            },
            required: ["make", "state"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_detailed_quote",
          description: "Get a detailed insurance quote with pricing after collecting year, make, model, odometer, and state. This initiates the full quote process with the MBH API.",
          parameters: {
            type: "object",
            properties: {
              state: {
                type: "string",
                description: "Two-character state code where the vehicle is registered (e.g., 'CA', 'NY', 'TX')"
              },
              year: {
                type: "string",
                description: "Vehicle year"
              },
              make: {
                type: "string",
                description: "Vehicle make"
              },
              model: {
                type: "string",
                description: "Vehicle model name"
              },
              trim: {
                type: "string",
                description: "Vehicle trim level"
              },
              modelClass: {
                type: "string",
                description: "Vehicle model class number from the models list"
              },
              vinPattern: {
                type: "string",
                description: "VIN pattern from the models list"
              },
              odometer: {
                type: "string",
                description: "Current odometer reading (numbers only)"
              }
            },
            required: ["state", "year", "make", "model", "modelClass", "vinPattern", "odometer"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_contract",
          description: "Create a contract after the customer agrees to the quote and provides payment information. This completes the full contract flow: submit quote, process deposit, and save contract.",
          parameters: {
            type: "object",
            properties: {
              firstName: {
                type: "string",
                description: "Customer's first name"
              },
              lastName: {
                type: "string",
                description: "Customer's last name"
              },
              email: {
                type: "string",
                description: "Customer's email address"
              },
              phone: {
                type: "string",
                description: "Customer's primary phone number (numbers only, e.g., '5551234567')"
              },
              alternatePhone: {
                type: "string",
                description: "Customer's alternate phone number (optional)"
              },
              address: {
                type: "string",
                description: "Customer's street address"
              },
              city: {
                type: "string",
                description: "Customer's city"
              },
              state: {
                type: "string",
                description: "Customer's state (2-character code)"
              },
              zip: {
                type: "string",
                description: "Customer's ZIP code"
              },
              vin: {
                type: "string",
                description: "Vehicle Identification Number (17 characters)"
              },
              cardNumber: {
                type: "string",
                description: "Credit card number (numbers only, e.g., '4111111111111111')"
              },
              cardExpiration: {
                type: "string",
                description: "Card expiration date in MM/YY or MM/YYYY format (e.g., '12/25')"
              },
              cardCVV: {
                type: "string",
                description: "Card CVV code (3 or 4 digits)"
              },
              cardHolder: {
                type: "string",
                description: "Name on the card (use '***customer***' if same as customer name)"
              }
            },
            required: ["firstName", "lastName", "email", "phone", "address", "city", "state", "zip", "vin", "cardNumber", "cardExpiration", "cardCVV", "cardHolder"]
          }
        }
      }
    ];

    // Format conversation history for context
    const messages = [
      { role: "system", content: systemPrompt }
    ];

    // Add conversation history (including tool calls and responses)
    history.forEach(msg => {
      const historyMsg = { role: msg.role, content: msg.content };
      if (msg.tool_calls) historyMsg.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) historyMsg.tool_call_id = msg.tool_call_id;
      if (msg.name) historyMsg.name = msg.name;
      messages.push(historyMsg);
    });

    // Add current message
    messages.push({ role: "user", content: content });

    // Generate response using GPT with function calling
    console.log(`[${requestId}] Generating response using LLM with tools`);
    let completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: messages,
      tools: tools,
      tool_choice: "auto",
      temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
      max_tokens: parseInt(process.env.MAX_TOKENS || "1000")
    });

    let assistantMessage = completion.choices[0].message;

    // Handle tool calls if present
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`[${requestId}] Processing ${assistantMessage.tool_calls.length} tool call(s)`);

      // Store assistant message with tool calls
      storeMessageInHistory(
        conversation?.id,
        'assistant',
        assistantMessage.content || '',
        assistantMessage.tool_calls
      );

      // Add assistant message to messages array
      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls
      });

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log(`[${requestId}] Calling function: ${functionName} with args:`, functionArgs);

        let functionResponse;
        try {
          if (functionName === 'get_vehicle_makes') {
            // MBH API requires state to get ref, then use ref to get makes
            console.log(`[${requestId}] Getting MBH makes for year ${functionArgs.year}, state ${functionArgs.state}`);

            // Step 1: Get quote years and ref
            const yearsData = await getQuoteYears(functionArgs.state);
            const quoteRef = yearsData.ref;

            // Store the ref for this conversation
            quoteReferences[conversation?.id] = quoteRef;

            // Step 2: Get makes for the year
            const makesData = await getQuoteMakes(quoteRef, functionArgs.year);

            functionResponse = JSON.stringify({
              ref: makesData.ref,
              makes: makesData.makes,
              message: `Found ${makesData.makes.length} vehicle makes for ${functionArgs.year}`
            });
          } else if (functionName === 'get_vehicle_models') {
            // Use stored ref to get models
            const quoteRef = quoteReferences[conversation?.id];

            if (!quoteRef) {
              // Fallback: get years first to establish ref
              console.log(`[${requestId}] No ref found, getting years first for state ${functionArgs.state}`);
              const yearsData = await getQuoteYears(functionArgs.state);
              quoteReferences[conversation?.id] = yearsData.ref;
            }

            const modelsData = await getQuoteModels(quoteReferences[conversation?.id], functionArgs.make);

            functionResponse = JSON.stringify({
              ref: modelsData.ref,
              models: modelsData.models,
              message: `Found ${modelsData.models.length} vehicle models for ${functionArgs.make}`
            });
          } else if (functionName === 'get_detailed_quote') {
            // Multi-step quote process
            console.log(`[${requestId}] Starting detailed quote process`);

            // Step 1: Get quote years and ref (or reuse existing ref)
            let quoteRef = quoteReferences[conversation?.id];
            if (!quoteRef) {
              const yearsData = await getQuoteYears(functionArgs.state);
              quoteRef = yearsData.ref;
              quoteReferences[conversation?.id] = quoteRef;
            }

            // Step 2: Get quote plan
            const planData = await getQuotePlan(
              quoteRef,
              functionArgs.model,
              functionArgs.modelClass,
              functionArgs.vinPattern,
              functionArgs.odometer
            );

            console.log(`[${requestId}] Quote plan data:`, JSON.stringify(planData));

            // Store vehicle and plan info for contract creation
            quoteData[conversation?.id] = {
              ref: quoteRef,
              state: functionArgs.state,
              year: functionArgs.year,
              make: functionArgs.make,
              model: functionArgs.model,
              trim: functionArgs.trim,
              modelClass: functionArgs.modelClass,
              vinPattern: functionArgs.vinPattern,
              odometer: functionArgs.odometer,
              plan: planData
            };

            functionResponse = JSON.stringify({
              success: true,
              quoteRef: quoteRef,
              plan: planData,
              message: "Quote generated successfully. Present pricing and coverage details to customer."
            });
          } else if (functionName === 'create_contract') {
            // Get the stored quote data for this conversation
            const storedQuote = quoteData[conversation?.id];
            const quoteRef = quoteReferences[conversation?.id];

            if (!quoteRef || !storedQuote) {
              functionResponse = JSON.stringify({
                error: 'No active quote found. Please get a quote first before creating a contract.'
              });
            } else {
              console.log(`[${requestId}] Creating contract with ref: ${quoteRef}`);

              try {
                // Step 1: Submit quote with customer and vehicle info
                const quotePayload = {
                  ref: quoteRef,
                  customer: {
                    name: {
                      first: functionArgs.firstName,
                      last: functionArgs.lastName
                    },
                    phone: {
                      primary: functionArgs.phone,
                      alternate: functionArgs.alternatePhone || null
                    },
                    email: functionArgs.email,
                    address: {
                      primary: functionArgs.address,
                      secondary: null
                    },
                    city: functionArgs.city,
                    state: functionArgs.state,
                    zip: functionArgs.zip,
                    zip4: null
                  },
                  policy: {
                    product: {
                      id: storedQuote.plan.product?.id || 4
                    },
                    monthly: storedQuote.plan.finance?.monthly?.toString() || "118",
                    deductible: storedQuote.plan.product?.deductible?.toString() || "200"
                  },
                  vehicle: {
                    class: storedQuote.modelClass,
                    odometer: storedQuote.odometer,
                    year: storedQuote.year,
                    make: storedQuote.make,
                    model: storedQuote.model,
                    vin: {
                      pattern: storedQuote.vinPattern,
                      vin: functionArgs.vin
                    },
                    surcharges: {}
                  }
                };

                console.log(`[${requestId}] Submitting quote:`, JSON.stringify(quotePayload));
                await submitQuote(quotePayload);

                // Step 2: Process deposit
                const depositPayload = {
                  ref: quoteRef,
                  payType: "cc",
                  cc: {
                    holder: functionArgs.cardHolder,
                    pan: functionArgs.cardNumber,
                    expiration: functionArgs.cardExpiration,
                    cvv: functionArgs.cardCVV
                  },
                  amount: storedQuote.plan.finance?.monthly || 118
                };

                console.log(`[${requestId}] Processing deposit for amount: ${depositPayload.amount}`);
                const depositResult = await processDeposit(depositPayload);

                // Step 3: Save contract
                console.log(`[${requestId}] Saving contract to Deal Manager`);
                const contractResult = await saveContract();

                functionResponse = JSON.stringify({
                  success: true,
                  message: "Contract created successfully!",
                  transaction: depositResult.transaction,
                  contract: contractResult,
                  details: {
                    monthlyPayment: storedQuote.plan.finance?.monthly,
                    deductible: storedQuote.plan.product?.deductible,
                    product: storedQuote.plan.product?.description
                  }
                });
              } catch (error) {
                console.error(`[${requestId}] Error creating contract:`, error);
                functionResponse = JSON.stringify({
                  error: 'Contract creation failed: ' + error.message,
                  details: error.response?.data || error.message
                });
              }
            }
          } else {
            functionResponse = JSON.stringify({ error: 'Unknown function' });
          }
        } catch (error) {
          console.error(`[${requestId}] Error executing function ${functionName}:`, error);
          functionResponse = JSON.stringify({ error: error.message });
        }

        console.log(`[${requestId}] Function ${functionName} response length: ${functionResponse.length} chars`);

        // Store tool response in history
        storeMessageInHistory(
          conversation?.id,
          'tool',
          functionResponse,
          null,
          toolCall.id,
          functionName
        );

        // Add tool response to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: functionName,
          content: functionResponse
        });
      }

      // Get next completion with tool results
      console.log(`[${requestId}] Getting next LLM response with tool results`);
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: messages,
        tools: tools,
        tool_choice: "auto",
        temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
        max_tokens: parseInt(process.env.MAX_TOKENS || "1000")
      });

      assistantMessage = completion.choices[0].message;
    }

    const response = assistantMessage.content;

    // Store the final AI response in history
    storeMessageInHistory(conversation?.id, 'assistant', response);

    // Turn OFF typing indicator before sending message
    await toggleTypingIndicator(conversation, account, 'off', requestId);

    // Send message to Chatwoot via API
    if (conversation?.id && account?.id) {
      const chatwootApiKey = process.env.CHATWOOT_API_KEY;

      if (!chatwootApiKey) {
        throw new Error('CHATWOOT_API_KEY environment variable not set');
      }

      console.log(`[${requestId}] Sending response to Chatwoot conversation ${conversation.id}`);
      
      const apiUrl = `${process.env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com'}/api/v1/accounts/${account.id}/conversations/${conversation.id}/messages`;
      
      const apiResponse = await axios.post(apiUrl, {
        content: response,
        message_type: 'outgoing',
        private: false,
        echo_id: requestId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'api_access_token': chatwootApiKey
        }
      });
      
      console.log(`[${requestId}] Message sent to Chatwoot successfully, status: ${apiResponse.status}`);
      
      // Optionally set conversation status to "open"
      if (process.env.AUTO_OPEN_CONVERSATION === 'true') {
        const toggleStatusUrl = `${process.env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com'}/api/v1/accounts/${account.id}/conversations/${conversation.id}/toggle_status`;
        
        try {
          await axios.post(toggleStatusUrl, {
            status: 'open'
          }, {
            headers: {
              'Content-Type': 'application/json',
              'api_access_token': chatwootApiKey
            }
          });
          console.log(`[${requestId}] Conversation status updated to "open"`);
        } catch (statusError) {
          console.error(`[${requestId}] Error updating conversation status:`, statusError.message);
        }
      }
    } else {
      console.log(`[${requestId}] Missing conversation or account data, cannot send response`);
    }
    
    // Log the interaction if logging is enabled
    if (process.env.ENABLE_LOGGING === 'true') {
      const logsDir = path.join(__dirname, 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      const logEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        conversationId: conversation?.id,
        userMessage: content,
        aiResponse: response,
        processingTime: Date.now() - startTime
      };
      
      const dateStr = new Date().toISOString().split('T')[0];
      const logFile = path.join(logsDir, `${dateStr}.jsonl`);
      fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    console.log(`[${requestId}] Request completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error(`[${requestId}] Error processing webhook:`, error);

    // Turn OFF typing indicator on error
    const { conversation, account } = req.body;
    await toggleTypingIndicator(conversation, account, 'off', requestId);
  }
});

app.listen(port, () => {
  console.log(`Chatwoot chatbot server running on port ${port}`);
  console.log(`Webhook endpoint: http://localhost:${port}/api/chatwoot`);
});