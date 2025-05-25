# Accent Conversion Server

A Twilio-powered application that converts Indian English accents to British English in real-time during phone calls using streaming audio without saving files.

## Features

- Receive phone calls via a Twilio number
- Transcribe Indian English speech to text using Google Cloud Speech-to-Text
- Convert text to British English voice using Google Cloud Text-to-Speech
- Stream converted speech back to the caller in real-time (no file saving)
- Supports both recorded audio (simple mode) and real-time streaming (advanced mode)
- WebSocket support using express-ws for real-time communication
- Uses Express built-in body parser (no external body-parser dependency)

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A Twilio account with a phone number
- Google Cloud Platform account with Speech-to-Text and Text-to-Speech APIs enabled

## Setup

1. Clone the repository:

```bash
git clone https://github.com/your-username/accent-conversion-ai.git
cd accent-conversion-ai
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Create a `.env` file in the root directory with the following variables:

```
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here

# Google Cloud Configuration (choose one method)
# Method 1: Use service account key file (place in config/creds.json)
# Method 2: Use API key
GOOGLE_API_KEY=your_google_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development
```

Alternatively, you can provide Google Cloud credentials in `config/creds.json`.

4. Start the server:

### Simple Mode (Record and Convert)

```bash
npm start
```

### Advanced Mode (Real-time Streaming)

```bash
node server-advanced.js
```

## Twilio Configuration

1. Set up your Twilio phone number to use a webhook for incoming calls.
2. For the "A Call Comes In" webhook, use your server's URL:
   - Simple mode: `https://your-server.com/voice-simple`
   - Advanced mode: `https://your-server.com/voice`

Note: Your server needs to be accessible via HTTPS for Twilio to connect to it. Use a service like ngrok for local development.

## Using ngrok for Local Development

1. Install ngrok:

```bash
npm install -g ngrok
```

2. Start your server locally:

```bash
node server-advanced.js
```

3. In another terminal, start ngrok:

```bash
ngrok http 3000
```

4. Use the provided HTTPS URL from ngrok in your Twilio webhook configuration.

## API Endpoints

### Voice Webhook
- `POST /voice` - Handles incoming Twilio voice calls

### Accent Conversion
- `POST /convert-accent` - Convert text to British accent
  - Body: `{ "text": "text to convert", "callSid": "optional_call_sid" }`

### Health Check
- `GET /health` - Server health status

## WebSocket Endpoints

The advanced server provides two WebSocket endpoints:

- `/media-stream` - Used by Twilio for streaming audio data
- `/ui-client` - For UI clients to monitor and display transcriptions

## Key Features

### Real-time Audio Streaming
- Audio is processed and streamed back to Twilio without saving files
- Uses MULAW encoding at 8kHz for Twilio compatibility
- Supports real-time transcription and accent conversion

### No File Storage
- Audio files are not saved to disk
- All processing happens in memory for better performance and privacy
- Audio is streamed directly back to the caller

### Express Built-in Parser
- Uses Express's built-in `express.urlencoded()` and `express.json()`
- No external body-parser dependency required

## Project Structure

- `server.js` - Main server file (simple record and convert mode)
- `server-advanced.js` - Advanced server with WebSocket streaming support
- `src/services/` - Core service classes
  - `AccentConverterService.js` - Handles text-to-speech conversion
  - `StreamingAccentConverter.js` - Handles real-time streaming (no file saving)
- `src/utils/` - Utility functions
  - `logger.js` - Logging utility

## License

MIT 