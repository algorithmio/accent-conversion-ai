require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const StreamingAccentConverter = require('./src/services/StreamingAccentConverter');
const logger = require('./src/utils/logger');

// Initialize Express app with WebSocket support
const app = express();
const server = http.createServer(app);
expressWs(app, server);
const PORT = process.env.PORT || 3000;

// Initialize the accent converter
const accentConverter = StreamingAccentConverter.getInstance();

// Configure middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Serve static audio files
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

// Main page
app.get('/', (req, res) => {
  res.send('Accent Conversion Server is running!');
});

// Handle incoming voice calls
app.post('/voice', (req, res) => {
  logger.info(`Incoming call from: ${req.body.From || 'Unknown'}`);
  
  // Create TwiML response
  const twiml = new VoiceResponse();
  
  // // Welcome message
  // twiml.say({
  //   voice: 'Polly.Brian-Neural',
  //   language: 'en-GB'
  // }, 'Welcome to the Accent Converter. Start speaking, and I will convert your accent to British English.');

  // Connect to media streams for real-time processing
  twiml.connect().stream({
    url: `wss://${req.headers.host}/media-stream`,
    track: 'both'  // Capture both inbound and outbound audio
  });

  // Set response headers and send TwiML
  res.type('text/xml');
  res.send(twiml.toString());
});

// Store active connections and their data
const activeConnections = new Map();

// Media Stream WebSocket endpoint
app.ws('/media-stream', (ws, req) => {
  logger.info('Media stream connected');
  
  // Set up streaming accent converter
  let recognizeStream;
  let currentCallSid = null;
  let transcriptions = [];
  
  ws.on('message', (message) => {
    // Parse the message
    const msg = JSON.parse(message);
    
    // Handle stream start event
    if (msg.event === 'start') {
      currentCallSid = msg.start.callSid;
      logger.info(`Media stream started for call: ${currentCallSid}`);
      
      // Initialize streaming with callback for handling transcription
      recognizeStream = accentConverter.createStreamHandler(async (transcript) => {
        if (!transcript) return;
        
        logger.info(`Processing transcript: ${transcript}`);
        transcriptions.push(transcript);
        
        try {
          // Convert transcript to British accent
          const audioBuffer = await accentConverter.convertTextToBritishAccent(transcript);
          
          if (audioBuffer) {
            // Save audio to file and get URL
            const filename = `response_${Date.now()}.mp3`;
            await accentConverter.saveAudioToFile(audioBuffer, filename);
            
            // Send TwiML to play the audio using Twilio's API
            const audioUrl = `https://${req.headers.host}/audio/${filename}`;
            
            // Broadcast to any UI clients that might be connected
            broadcastTranscription(transcript, audioUrl);
            
            // In a real implementation, you would use Twilio's API to send TwiML
            // that plays this audio back to the caller
            logger.info(`Audio response ready at: ${audioUrl}`);
          }
        } catch (error) {
          logger.error('Error processing transcript:', error);
        }
      });
      
      // Store the connection data
      activeConnections.set(ws, {
        callSid: currentCallSid,
        recognizeStream,
        transcriptions
      });
    }
    
    // Handle media event with audio data
    if (msg.event === 'media') {
      if (recognizeStream && msg.media && msg.media.payload) {
        // Process the audio data
        const payload = Buffer.from(msg.media.payload, 'base64');
        recognizeStream.write(payload);
      }
    }
    
    // Handle stream stop event
    if (msg.event === 'stop') {
      logger.info(`Media stream stopped for call: ${currentCallSid}`);
      
      if (recognizeStream) {
        recognizeStream.end();
      }
      
      // Clean up the connection data
      activeConnections.delete(ws);
    }
  });
  
  ws.on('close', () => {
    logger.info(`Media stream connection closed for call: ${currentCallSid}`);
    
    // Get connection data
    const connectionData = activeConnections.get(ws);
    
    // Clean up resources
    if (connectionData && connectionData.recognizeStream) {
      connectionData.recognizeStream.end();
    }
    
    // Remove from active connections
    activeConnections.delete(ws);
  });
});

// Client UI WebSocket endpoint (for monitoring and debugging)
app.ws('/ui-client', (ws, req) => {
  logger.info('UI client connected');
  
  // Send initial state
  const activeCalls = Array.from(activeConnections.values()).map(data => ({
    callSid: data.callSid,
    transcriptions: data.transcriptions
  }));
  
  ws.send(JSON.stringify({
    type: 'init',
    activeCalls
  }));
  
  ws.on('close', () => {
    logger.info('UI client disconnected');
  });
});

// Function to broadcast transcription to UI clients
function broadcastTranscription(transcript, audioUrl) {
  // Find all UI client connections
  app.getWss().clients.forEach(client => {
    // Check if this is a UI client connection
    if (client.protocol === 'ui-client' && client.readyState === 1) {
      client.send(JSON.stringify({
        type: 'transcription',
        data: {
          original: transcript,
          converted: audioUrl,
          timestamp: new Date().toISOString()
        }
      }));
    }
  });
}

// Start the server
server.listen(PORT, () => {
  logger.info(`Advanced Accent Conversion Server running on port ${PORT}`);
}); 