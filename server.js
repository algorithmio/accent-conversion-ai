require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const speech = require('@google-cloud/speech').v1p1beta1;
const textToSpeech = require('@google-cloud/text-to-speech');
const path = require('path');
const fs = require('fs');

// Initialize Express app with WebSocket support
const app = express();
const server = require('http').createServer(app);
expressWs(app, server);
const PORT = process.env.PORT || 4001;

// Initialize Google Cloud clients
let sttClient, ttsClient;

try {
  const credentialsPath = path.join(__dirname, 'config/creds.json');
  
  if (fs.existsSync(credentialsPath)) {
    console.log('✅ Using Google Cloud credentials from config/creds.json');
    sttClient = new speech.SpeechClient({ keyFilename: credentialsPath });
    ttsClient = new textToSpeech.TextToSpeechClient({ keyFilename: credentialsPath });
  } else {
    console.log('❌ No credentials file found at config/creds.json');
    console.log('📝 Please create config/creds.json with your Google Cloud service account credentials');
    console.log('📋 You can use config/creds.json.template as a reference');
    console.log('🔗 Get credentials from: https://console.cloud.google.com/iam-admin/serviceaccounts');
    console.log('⚠️  Make sure to enable Speech-to-Text and Text-to-Speech APIs');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error initializing Google Cloud clients:', error.message);
  console.log('📝 Please check your config/creds.json file format');
  process.exit(1);
}

// Configure middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Store active connections
const activeConnections = new Map();

// Main page
app.get('/', (req, res) => {
  res.send('Real-time Accent Conversion Server is running!');
});

// Handle incoming voice calls
app.post('/voice', (req, res) => {
  const callSid = req.body.CallSid;
  console.log(`Incoming call: ${callSid}`);
  
  const twiml = new VoiceResponse();
  
  // Brief welcome
  twiml.say('Ready. Speak now.');

  // Use Connect Stream for bidirectional streaming
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.get('host')}/stream`
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// WebSocket endpoint for media streaming
app.ws('/stream', (ws, req) => {
  console.log('New WebSocket connection');
  
  let callSid = null;
  let streamSid = null;
  let recognizeStream = null;
  let audioChunks = [];
  let isConverting = false;
  let streamDestroyed = false;

  // Function to create a new recognition stream
  function createRecognitionStream() {
    if (recognizeStream && !streamDestroyed) {
      try {
        recognizeStream.end();
      } catch (error) {
        console.log('Error ending previous stream:', error.message);
      }
    }

    streamDestroyed = false;
    
    recognizeStream = sttClient.streamingRecognize({
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        languageCode: 'en-IN',
        model: 'telephony',
        useEnhanced: true,
        enableAutomaticPunctuation: true
      },
      interimResults: false
    });

    recognizeStream.on('data', async (data) => {
      if (data.results && data.results[0] && data.results[0].isFinal) {
        const transcript = data.results[0].alternatives[0].transcript;
        console.log(`Transcribed: "${transcript}"`);
        
        if (transcript && transcript.trim() && !isConverting) {
          isConverting = true;
          
          // Small delay to ensure user has finished speaking
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await convertAndSendAudio(transcript, ws, streamSid);
          isConverting = false;
        }
      }
    });

    recognizeStream.on('error', (error) => {
      console.error('Recognition error:', error.message);
      streamDestroyed = true;
      
      // Recreate stream after a delay if connection is still active
      setTimeout(() => {
        if (activeConnections.has(callSid) && !streamDestroyed) {
          console.log('Recreating recognition stream...');
          createRecognitionStream();
        }
      }, 2000);
    });

    recognizeStream.on('end', () => {
      console.log('Recognition stream ended');
      streamDestroyed = true;
    });

    recognizeStream.on('close', () => {
      console.log('Recognition stream closed');
      streamDestroyed = true;
    });

    return recognizeStream;
  }

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      
      // Debug: Log all incoming messages
      if (msg.event !== 'media') {
        console.log(`📨 Received: ${msg.event}`, msg.event === 'start' ? `CallSid: ${msg.start?.callSid}` : '');
      }
      
      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`🎙️  Stream started: ${callSid}`);
          
          activeConnections.set(callSid, { ws, streamSid });
          
          // Create initial recognition stream
          createRecognitionStream();
          
          break;

        case 'media':
          if (recognizeStream && !streamDestroyed && msg.media && msg.media.payload) {
            const audioData = Buffer.from(msg.media.payload, 'base64');
            
            // Accumulate audio chunks
            audioChunks.push(audioData);
            
            // Send audio to recognition every 500ms worth of data
            if (audioChunks.length >= 20) { // ~500ms at 8kHz
              const combinedAudio = Buffer.concat(audioChunks);
              audioChunks = [];
              
              try {
                // Check if stream is still writable before writing
                if (recognizeStream && !streamDestroyed && recognizeStream.writable) {
                  recognizeStream.write(combinedAudio);
                } else {
                  console.log('Stream not writable, recreating...');
                  createRecognitionStream();
                }
              } catch (error) {
                console.error('Error writing to recognition stream:', error.message);
                streamDestroyed = true;
                createRecognitionStream();
              }
            }
          }
          break;

        case 'stop':
          console.log(`🛑 Stream stopped: ${callSid}`);
          streamDestroyed = true;
          if (recognizeStream) {
            try {
              recognizeStream.end();
            } catch (error) {
              console.log('Error ending stream on stop:', error.message);
            }
          }
          activeConnections.delete(callSid);
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket closed: ${callSid}`);
    streamDestroyed = true;
    
    if (recognizeStream) {
      try {
        recognizeStream.end();
      } catch (error) {
        console.log('Error ending stream on close:', error.message);
      }
    }
    
    if (callSid) {
      activeConnections.delete(callSid);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    streamDestroyed = true;
  });
});

// Function to convert text to British accent and send back
async function convertAndSendAudio(text, ws, streamSid) {
  try {
    console.log(`Converting to British accent: "${text}"`);
    
    // Check if WebSocket is still open
    if (ws.readyState !== ws.OPEN) {
      console.log('WebSocket not open, skipping audio send');
      return;
    }
    
    // Convert to British English speech
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { 
        languageCode: 'en-GB', 
        name: 'en-GB-Neural2-B',
        ssmlGender: 'MALE' 
      },
      audioConfig: { 
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000
      }
    });
    
    if (response.audioContent && ws.readyState === ws.OPEN) {
      console.log(`Audio content size: ${response.audioContent.length} bytes`);
      
      // For bidirectional streams, send the entire audio as one message
      const audioBase64 = response.audioContent.toString('base64');
      
      // Correct message format for bidirectional streams
      const mediaMessage = {
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: audioBase64
        }
      };
      
      try {
        ws.send(JSON.stringify(mediaMessage));
        console.log(`✅ Sent British accent audio for: "${text}"`);
      } catch (wsError) {
        console.error('Error sending WebSocket message:', wsError.message);
      }
    } else {
      console.log('No audio content or WebSocket closed');
    }
  } catch (error) {
    console.error('Error converting audio:', error.message);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    activeConnections: activeConnections.size
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: https://your-ngrok-url.ngrok.io/voice`);
  console.log(`Health check: http://localhost:${PORT}/health`);
}); 