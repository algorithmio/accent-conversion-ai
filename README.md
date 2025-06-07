# Accent Conversion AI

A Twilio-powered application that converts Indian English accents to British English in real-time during phone calls using streaming audio processing.

## Features

- Receive phone calls via a Twilio number
- Real-time transcription using Deepgram Speech-to-Text API
- Convert text to British English voice using Google Cloud Text-to-Speech
- Stream converted speech back to the caller in real-time
- WebSocket support for bidirectional audio streaming
- No file storage - all processing happens in memory for better performance and privacy

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A Twilio account with a phone number
- Google Cloud Platform account with Text-to-Speech API enabled
- Deepgram account for speech-to-text processing

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/algorithmio/accent-conversion-ai
cd accent-conversion-ai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Google Cloud Setup

#### Create a Google Cloud Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Text-to-Speech API**

#### Create Service Account

1. Go to **IAM & Admin** > **Service Accounts**
2. Click **Create Service Account**
3. Give it a name like "accent-converter"
4. Grant the **Cloud Text-to-Speech Client** role
5. Click **Done**

#### Generate Credentials

1. Click on your newly created service account
2. Go to **Keys** tab
3. Click **Add Key** > **Create New Key**
4. Choose **JSON** format
5. Download the file

#### Setup Credentials File

1. Copy the downloaded JSON file to `config/creds.json` in your project
2. The file should look like this:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "accent-converter@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

### 4. Environment Variables

Create a `.env` file in the root directory:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here

# Deepgram Configuration
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Server Configuration
PORT=4001
NODE_ENV=development
```

### 5. Start the Server

```bash
npm start
```

Or run directly:

```bash
node server.js
```

## Twilio Configuration

1. Set up your Twilio phone number to use a webhook for incoming calls
2. For the "A Call Comes In" webhook, use: `https://your-server.com/voice`

**Note:** Your server needs to be accessible via HTTPS for Twilio to connect to it. Use ngrok for local development.

## Using ngrok for Local Development

1. Install ngrok:

```bash
npm install -g ngrok
```

2. Start your server locally:

```bash
node server.js
```

3. In another terminal, start ngrok:

```bash
ngrok http 4001
```

4. Use the provided HTTPS URL from ngrok in your Twilio webhook configuration.

## API Endpoints

### Voice Webhook
- `POST /voice` - Handles incoming Twilio voice calls and sets up WebSocket streaming

### Health Check
- `GET /health` - Server health status and active connection count

### WebSocket Endpoint
- `WS /stream` - WebSocket endpoint for Twilio media streaming

## Architecture

The application uses a streaming architecture with the following components:

- **DeepgramStreamingService** - Real-time speech-to-text transcription
- **StreamingAccentConverterV2** - Manages streaming TTS sessions
- **StreamingTTSService** - Google Cloud Text-to-Speech streaming integration

## Key Features

### Real-time Audio Processing
- Audio is processed and streamed back to Twilio without saving files
- Uses MULAW encoding at 8kHz for Twilio compatibility
- Supports real-time transcription and accent conversion with minimal latency

### No File Storage
- Audio files are not saved to disk
- All processing happens in memory for better performance and privacy
- Audio is streamed directly back to the caller

### Intelligent Content Processing
- Advanced text deduplication to prevent repeated audio
- Natural conversation flow with timing-based decisions
- Handles both interim and final transcription results

## Project Structure

```
├── server.js                          # Main application server
├── src/
│   ├── services/
│   │   ├── DeepgramStreamingService.js     # Speech-to-text service
│   │   ├── StreamingAccentConverterV2.js   # Main streaming converter
│   │   └── StreamingTTSService.js          # Text-to-speech service
│   └── config/
│       └── tts-config.js                   # TTS configuration
├── config/
│   └── creds.json                          # Google Cloud credentials
└── package.json
```

## Security Notes

- ⚠️ **Never commit credentials to git** (already excluded in .gitignore)
- 🔒 Keep your credentials file secure
- 🔄 Rotate keys regularly for production use

## Troubleshooting

### Google Cloud Issues
- **File not found**: Make sure `config/creds.json` exists
- **Invalid format**: Check JSON syntax with a validator
- **API errors**: Ensure Text-to-Speech API is enabled in Google Cloud Console
- **Permission errors**: Verify service account has correct roles

### Deepgram Issues
- **Authentication errors**: Verify your Deepgram API key in `.env`
- **Connection issues**: Check your internet connection and API limits

### Twilio Issues
- **Webhook errors**: Ensure your server is accessible via HTTPS
- **Audio quality**: Verify MULAW encoding and 8kHz sample rate

## License

MIT 