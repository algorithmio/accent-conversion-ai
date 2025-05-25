# Accent Conversion Server

A Twilio-powered application that converts Indian English accents to British English in real-time during phone calls.

## Features

- Receive phone calls via a Twilio number
- Transcribe Indian English speech to text using Google Cloud Speech-to-Text
- Convert text to British English voice using Google Cloud Text-to-Speech
- Play converted speech back to the caller
- Supports both recorded audio (simple mode) and real-time streaming (advanced mode)
- WebSocket support using express-ws for real-time communication

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
PORT=3000
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
GOOGLE_API_KEY=your_google_api_key
```

Alternatively, you can provide Google Cloud credentials in `config/creds.json`.

4. Start the server:

### Simple Mode (Record and Convert)

```bash
npm start
```

### Advanced Mode (Real-time Streaming)

```bash
npm run start:advanced
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
npm start
```

3. In another terminal, start ngrok:

```bash
ngrok http 3000
```

4. Use the provided HTTPS URL from ngrok in your Twilio webhook configuration.

## WebSocket Endpoints

The advanced server provides two WebSocket endpoints:

- `/media-stream` - Used by Twilio for streaming audio data
- `/ui-client` - For UI clients to monitor and display transcriptions

## Project Structure

- `server.js` - Main server file (simple record and convert mode)
- `server-advanced.js` - Advanced server with WebSocket streaming support
- `src/services/` - Core service classes
  - `AccentConverterService.js` - Handles text-to-speech conversion
  - `StreamingAccentConverter.js` - Handles real-time streaming
- `src/utils/` - Utility functions
  - `logger.js` - Logging utility

## License

MIT 