# Real-time Accent Conversion AI

A Node.js application that converts speech from Indian English accent to British English accent in real-time using Google Cloud Speech-to-Text and Text-to-Speech APIs.

## How It Works

1. Speak in an Indian English accent into your microphone
2. Your audio is streamed to Google Speech-to-Text API in real-time
3. The transcribed text is converted to speech using Google Text-to-Speech with a British accent
4. The converted audio is immediately played back with a British accent

## Prerequisites

- Node.js 14.x or higher
- Google Cloud Platform account with Speech-to-Text and Text-to-Speech APIs enabled
- Google Cloud API key with access to Speech-to-Text and Text-to-Speech APIs
- A modern web browser with WebRTC support (Chrome, Firefox, Edge, etc.)

## Setup

1. Clone this repository
   ```
   git clone https://github.com/yourusername/accent-conversion-ai.git
   cd accent-conversion-ai
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Set up Google Cloud API key:
   - Make sure your API key has access to Speech-to-Text and Text-to-Speech APIs
   - Set your API key in your `.env` file:
   ```
   cp .env.example .env
   # Edit .env and set GOOGLE_API_KEY to your API key
   ```

4. Start the application
   ```
   npm start
   ```

5. The application will be available at `http://localhost:3000`

## Features

- **Real-time audio streaming** - Audio is processed as you speak, with minimal latency
- **Live transcription** - See your words transcribed in real-time
- **Audio visualizer** - Visual feedback of your voice input
- **Volume level indicator** - Monitor your microphone input level
- **Adjustable microphone sensitivity** - Fine-tune input sensitivity

## API Endpoints

The application exposes two sets of interfaces:

### RESTful API (for file-based processing)

#### Convert Audio File
```
POST /api/accent/convert
Content-Type: multipart/form-data

Form data:
- audio: <audio_file>
```

#### Download Converted Audio
```
GET /download/:fileName
```

### WebSocket API (for real-time processing)

The WebSocket API is used by the web client for real-time audio streaming and accent conversion.

#### Events from Client to Server:
- `startStreaming`: Initiates a streaming session
- `audioData`: Sends audio data chunks to the server
- `stopStreaming`: Ends the streaming session

#### Events from Server to Client:
- `streamingReady`: Confirms streaming session has started
- `transcript`: Provides real-time transcription updates
- `audioResult`: Delivers converted audio with British accent
- `error`: Reports any errors during processing

## Development

### Run Tests
```
npm test
```

## Technologies Used

- Node.js and Express.js
- Socket.IO for real-time communication
- Web Audio API for audio capture and processing
- Google Cloud Speech-to-Text API with streaming recognition
- Google Cloud Text-to-Speech API
- Jest for testing

## Project Structure

```
├── index.js                 # Application entry point
├── public/                  # Static files
│   └── index.html           # Frontend UI with real-time processing
├── src/
│   ├── controllers/         # API controllers
│   │   ├── AccentController.js
│   │   └── StreamingController.js
│   ├── routes/              # API routes
│   │   └── accentRoutes.js
│   └── services/            # Business logic
│       ├── AccentConversionService.js
│       └── SpeechService.js
├── test/                    # Test files
├── uploads/                 # Uploaded audio files (for non-streaming mode)
└── converted/               # Converted audio files (for non-streaming mode)
```

## License

MIT 