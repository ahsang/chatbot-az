# Chatwoot Chatbot

A simple, customizable chatbot for Chatwoot that uses OpenAI to provide intelligent responses. Features conversation history, customizable system prompts, and easy integration with Chatwoot webhooks.

## Features

- 🤖 **OpenAI Integration**: Powered by GPT models for intelligent responses
- 💬 **Conversation History**: Maintains context across messages
- 🎯 **Customizable System Prompt**: Define your chatbot's personality and behavior
- 🔄 **Auto-Assignment Detection**: Stops responding when human agents take over
- 📝 **Optional Logging**: Track conversations for analysis
- ⚡ **Simple Setup**: Minimal configuration required

## Prerequisites

- Node.js (v14 or higher)
- OpenAI API Key
- Chatwoot Account with API Access Token

## Installation

1. Clone or download this repository:
```bash
git clone <your-repo-url>
cd chatbot
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
# Required
OPENAI_API_KEY=your_openai_api_key_here
CHATWOOT_API_KEY=your_chatwoot_api_access_token_here

# Optional - Customize these
SYSTEM_PROMPT="You are a helpful assistant..."
OPENAI_MODEL=gpt-4o-mini
TEMPERATURE=0.7
MAX_TOKENS=500
```

5. Start the server:
```bash
npm start
```

## Chatwoot Setup

1. In your Chatwoot dashboard, go to **Settings** → **Integrations** → **Webhooks**
2. Add a new webhook with:
   - **URL**: `http://your-server:3004/api/chatwoot`
   - **Events**: Select `message_created`
3. Save and test the webhook

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | Required |
| `CHATWOOT_API_KEY` | Your Chatwoot API access token | Required |
| `CHATWOOT_BASE_URL` | Chatwoot instance URL | `https://app.chatwoot.com` |
| `SYSTEM_PROMPT` | Customize your chatbot's behavior | Default assistant prompt |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-4o-mini` |
| `TEMPERATURE` | Response creativity (0-1) | `0.7` |
| `MAX_TOKENS` | Maximum response length | `500` |
| `PORT` | Server port | `3004` |
| `ENABLE_LOGGING` | Save conversations to logs | `true` |
| `AUTO_OPEN_CONVERSATION` | Auto-open conversations | `true` |

### Customizing the System Prompt

Edit the `SYSTEM_PROMPT` in your `.env` file to define your chatbot's personality:

```env
SYSTEM_PROMPT="You are a customer support agent for ACME Corp. Be professional, helpful, and always mention our 24/7 support line at 1-800-ACME when relevant."
```

## API Endpoints

- `POST /api/chatwoot` - Webhook endpoint for Chatwoot
- `GET /health` - Health check endpoint

## Features in Detail

### Conversation History
The bot maintains the last 10 messages of each conversation for context.

### Human Agent Detection
Automatically stops responding when a human agent is assigned to the conversation.

### Logging
When enabled, saves conversations to `logs/YYYY-MM-DD.jsonl` files.

## Development

Run in development mode with auto-reload:
```bash
npm run dev
```

## Deployment

For production, consider using:
- PM2 for process management
- Nginx for reverse proxy
- SSL certificates for HTTPS

## License

MIT