# Real-time Accent Conversion

A real-time accent conversion system that converts Indian English accent to British English accent.

## Overview

This MVP demonstrates real-time accent conversion using streaming speech-to-text and text-to-speech technologies. The application allows users to speak in their natural Indian English accent, and the system converts it to British English accent in real-time.

## How it Works

1. The user speaks into their microphone
2. The audio is streamed to the server in real-time
3. The server uses Google Cloud Speech-to-Text API to transcribe the Indian English speech
4. The transcription is then converted to British English speech using Google Cloud Text-to-Speech API
5. The converted audio is streamed back to the client and played

## Features

- Real-time streaming audio processing
- Low-latency accent conversion
- Support for continuous speech
- Browser-based client with simple UI
- Command-line validator for quick testing

## Technical Architecture

- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.io for bidirectional streaming
- **Speech Services**: Google Cloud Speech-to-Text and Text-to-Speech APIs
- **Frontend**: HTML, CSS, JavaScript

## Setup and Installation

### Prerequisites

- Node.js (v14 or later)
- Google Cloud Platform account with Speech-to-Text and Text-to-Speech APIs enabled
- Google Cloud credentials
- SoX (Sound eXchange) for command-line validation tool

### Installing SoX (required for command-line validator)

SoX is required for the command-line validator as it provides audio capture capabilities.

**On macOS:**
```bash
brew install sox
```

**On Ubuntu/Debian:**
```bash
sudo apt-get install sox libsox-fmt-all
```

**On Windows:**
- Download from [SoX website](http://sox.sourceforge.net/)
- Or install with Chocolatey: `choco install sox.portable`
- Make sure to add SoX to your PATH environment variable

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
GOOGLE_API_KEY=your_google_api_key
PORT=3000
```

Alternatively, you can use a service account by placing your `creds.json` file in the `config` directory.

### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open your browser and navigate to `http://localhost:3000`

## Usage

### Web Interface

1. Click the "Start Recording" button
2. Speak in your natural Indian English accent
3. The system will transcribe your speech and convert it to British English accent in real-time
4. The converted audio will play automatically

### Command-line Validator

For quick testing of the accent conversion idea, you can use the command-line validator:

```bash
# Run using npm script
npm run validate

# Or use the shell script (more user-friendly)
./scripts/validate.sh
```

The command-line validator will:
1. Listen to your microphone input
2. Transcribe your speech in real-time
3. Convert the transcription to British English speech
4. Play the converted speech through your computer's speakers

This is a great way to quickly validate the concept without setting up the web interface.

### Troubleshooting

If you encounter the error `Error: spawn rec ENOENT`, it means SoX is not installed or not in your PATH. See the "Installing SoX" section above.

## Development

### Project Structure

```
accent-conversion-ai/
├── config/            # Configuration files and Google Cloud credentials
├── public/            # Static files and frontend
├── scripts/           # Utility scripts including validation tools
├── src/
│   ├── controllers/   # Request handlers
│   ├── routes/        # API routes
│   ├── services/      # Core services for speech processing
├── index.js           # Entry point
├── package.json       # Dependencies and scripts
```

### Key Components

- **StreamingAccentService**: Handles real-time accent conversion with streaming APIs
- **StreamingController**: Manages WebSocket connections and audio streaming
- **Frontend**: Browser client for recording and playback
- **Validator Script**: Command-line tool for quick testing

## Limitations and Future Work

This MVP has the following limitations:

- Processing delay depends on network conditions and API response times
- Limited error handling and recovery
- Basic UI with minimal feedback
- No user settings or customization options

Future improvements could include:

- Support for multiple accent conversions
- User-configurable accent settings
- Improved audio quality and reduced latency
- Better error handling and recovery
- Enhanced visualizations and feedback
- Mobile app support

## License

MIT 