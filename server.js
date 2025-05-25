require('dotenv').config();
const express = require('express');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const AccentConverterService = require('./src/services/AccentConverterService');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Initialize the accent converter service
const accentConverter = AccentConverterService.getInstance();

// Welcome endpoint
app.get('/', (req, res) => {
  res.send('Accent Conversion Server is running!');
});

// Handle incoming voice calls
app.post('/voice', (req, res) => {
  logger.info(`Incoming call from: ${req.body.From}`);
  
  const twiml = new VoiceResponse();
  
  // Add welcome message
  twiml.say({
    voice: 'Polly.Brian-Neural',
    language: 'en-GB'
  }, 'Welcome to the Accent Converter. Please speak after the beep.');
  
  // Add a beep
  twiml.play({ digits: '1' });
  
  // Start recording and convert speech
  twiml.record({
    action: '/process-speech',
    transcribeCallback: '/transcribe',
    maxLength: 30,
    transcribe: true,
    transcribeLanguage: 'en-IN',
    playBeep: true
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Process transcribed speech
app.post('/transcribe', async (req, res) => {
  const transcription = req.body.TranscriptionText;
  logger.info(`Transcription received: ${transcription}`);
  
  // Store transcription for processing
  if (transcription) {
    // We'll just acknowledge this webhook
    res.sendStatus(200);
  } else {
    logger.error('No transcription received');
    res.sendStatus(400);
  }
});

// Process speech recording
app.post('/process-speech', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const callSid = req.body.CallSid;
  
  logger.info(`Processing speech for call: ${callSid}`);
  logger.info(`Recording URL: ${recordingUrl}`);
  
  const twiml = new VoiceResponse();
  
  try {
    // For the MVP, we'll use Twilio's transcription and then TTS for British accent
    const transcription = req.body.TranscriptionText;
    
    if (transcription) {
      logger.info(`Using transcription: ${transcription}`);
      
      // Process the transcription through our accent converter
      const convertedAudio = await accentConverter.convertTextToBritishAccent(transcription);
      
      // If we have audio data, we can play it directly in the response
      if (convertedAudio) {
        // For now, we'll use Twilio's TTS with British voice
        twiml.say({
          voice: 'Polly.Brian-Neural',
          language: 'en-GB'
        }, transcription);
      } else {
        // Fallback if conversion failed
        twiml.say('I apologize, but I was unable to convert your accent.');
      }
    } else {
      twiml.say('I apologize, but I could not understand what you said.');
    }
    
    // Add option to record again
    twiml.gather({
      numDigits: 1,
      action: '/handle-key',
      timeout: 10
    }).say('Press 1 to speak again, or any other key to end the call.');
  } catch (error) {
    logger.error('Error processing speech:', error);
    twiml.say('I apologize, but there was an error processing your speech.');
    twiml.hangup();
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Handle keypress for recording again or ending call
app.post('/handle-key', (req, res) => {
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  
  if (digit === '1') {
    // Redirect to voice endpoint to record again
    twiml.redirect('/voice');
  } else {
    twiml.say('Thank you for using the Accent Converter. Goodbye!');
    twiml.hangup();
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Accent Conversion Server running on port ${PORT}`);
}); 