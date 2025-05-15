#!/usr/bin/env node
require('dotenv').config();
const Mic = require('node-microphone');
const speech = require('@google-cloud/speech').v1p1beta1;
const textToSpeech = require('@google-cloud/text-to-speech');
const Speaker = require('speaker');
const path = require('path');
const chalk = require('chalk');
const fs = require('fs');
const { execSync } = require('child_process');

console.log(chalk.blue('🎤 Real-time Accent Conversion Validator'));
console.log(chalk.blue('----------------------------------------'));
console.log(chalk.yellow('Converting Indian English accent to British English in real-time'));
console.log(chalk.yellow('Speak clearly into your microphone to test the conversion'));
console.log(chalk.yellow('Press Ctrl+C to exit'));
console.log(chalk.blue('----------------------------------------'));

// Check if SoX is installed
try {
  // Check if the 'rec' command is available
  execSync('which rec || where rec', { stdio: 'ignore' });
} catch (error) {
  console.error(chalk.red('✗ Error: SoX (Sound eXchange) is not installed'));
  console.error(chalk.yellow('The node-microphone package requires SoX for audio recording.'));
  console.error('');
  console.error('To install SoX:');
  console.error('');
  console.error('On macOS:');
  console.error('  brew install sox');
  console.error('');
  console.error('On Ubuntu/Debian:');
  console.error('  sudo apt-get install sox libsox-fmt-all');
  console.error('');
  console.error('On Windows:');
  console.error('  Download from http://sox.sourceforge.net/');
  console.error('  Or install with Chocolatey: choco install sox.portable');
  console.error('');
  process.exit(1);
}

// Check if credentials are available
const credentialsPath = path.join(__dirname, '../config/creds.json');
const hasCredentials = fs.existsSync(credentialsPath);

// Initialize clients
let sttClient, ttsClient;

try {
  // Use credentials file if available, otherwise use API key
  if (hasCredentials) {
    console.log(chalk.green('✓ Using Google Cloud credentials from config/creds.json'));
    sttClient = new speech.SpeechClient({
      keyFilename: credentialsPath
    });
    ttsClient = new textToSpeech.TextToSpeechClient({
      keyFilename: credentialsPath
    });
  } else if (process.env.GOOGLE_API_KEY) {
    console.log(chalk.green('✓ Using Google API Key from environment variables'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
    sttClient = new speech.SpeechClient();
    ttsClient = new textToSpeech.TextToSpeechClient();
  } else {
    throw new Error('No authentication credentials found. Please provide a credentials file or API key.');
  }
} catch (error) {
  console.error(chalk.red('✗ Error initializing Google Cloud clients:'), error.message);
  process.exit(1);
}

// Add audio device detection
function getAudioDevices() {
  try {
    const output = execSync('sox -h').toString();
    if (output.includes('--list-devices')) {
      const devices = execSync('sox -h --list-devices').toString();
      return devices;
    }
    return null;
  } catch (error) {
    console.error(chalk.yellow('Warning: Could not detect audio devices'));
    return null;
  }
}

// Get default output device for macOS
function getDefaultOutputDevice() {
  try {
    const output = execSync('system_profiler SPAudioDataType').toString();
    const defaultDevice = output.match(/Default Output Device: Yes[\s\S]*?Location: (.*?)(?:\n|$)/);
    return defaultDevice ? defaultDevice[1].trim() : 'default';
  } catch (error) {
    return 'default';
  }
}

// Audio Capture Configuration
const micOptions = { 
  rate: '16000', 
  channels: '1',
  debug: false,
  exitOnSilence: 0,
  device: 'default'
};

// Speaker Setup with error handling
let speaker;
try {
  const defaultDevice = getDefaultOutputDevice();
  console.log(chalk.blue('Using audio output device:'), defaultDevice);

  speaker = new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000,
    device: defaultDevice,
    signed: true,
    float: false,
    // Add CoreAudio specific options
    coreaudio: {
      device: defaultDevice,
      channels: 1,
      sampleRate: 24000,
      format: 's16le'
    }
  });

  speaker.on('error', (error) => {
    console.error(chalk.red('✗ Speaker error:'), error.message);
    
    if (error.message.includes('CoreAudio') || error.message.includes('AudioConverter')) {
      console.error(chalk.yellow('CoreAudio error detected. Trying to recover...'));
      // Attempt to recreate speaker with default settings
      try {
        speaker = new Speaker({
          channels: 1,
          bitDepth: 16,
          sampleRate: 24000,
          device: 'default',
          signed: true,
          float: false
        });
        console.log(chalk.green('✓ Successfully recovered audio output'));
      } catch (recoveryError) {
        console.error(chalk.red('✗ Failed to recover audio output:'), recoveryError.message);
        console.error(chalk.yellow('Please try:'));
        console.error(chalk.yellow('1. Disconnecting and reconnecting your headphones'));
        console.error(chalk.yellow('2. Checking System Preferences > Sound > Output'));
        console.error(chalk.yellow('3. Restarting the application'));
        cleanup();
      }
    } else if (error.message.includes('ENOENT') || error.message.includes('device')) {
      console.error(chalk.yellow('Please check your headphone connection and try again.'));
      console.error(chalk.yellow('If using Bluetooth headphones, ensure they are properly paired and connected.'));
      cleanup();
    }
  });
} catch (error) {
  console.error(chalk.red('✗ Error initializing speaker:'), error.message);
  if (error.message.includes('CoreAudio')) {
    console.error(chalk.yellow('CoreAudio initialization failed. Please check your audio settings.'));
  }
  process.exit(1);
}

// Track last transcript to avoid duplicate TTS calls
let lastTranscript = '';
let isSpeaking = false;
let micInstance = null;
let recognizeStream = null;
let transcriptBuffer = '';

// STT Streaming Config
const sttRequest = {
  config: {
    encoding: 'LINEAR16',
    sampleRateHertz: 16000,
    languageCode: 'en-IN',
    model: 'telephony', // Good for phone quality audio
    useEnhanced: true,
    enableAutomaticPunctuation: true,
    speechContexts: [
      {
        phrases: ["Indian English", "accent", "pronunciation"],
        boost: 10,
      },
    ],
  },
  interimResults: true,
};

// TTS Synthesis Function
async function synthesizeBritishVoice(text, isInterim = false) {
  // Don't process empty text or while already speaking
  if (text.trim() === '' || isSpeaking) {
    return;
  }
  
  // For interim results, only process if significantly different from last transcript
  if (isInterim) {
    // Only process interim results that are at least 5 chars and different enough from last transcript
    if (text.length < 5 || (lastTranscript && text.startsWith(lastTranscript))) {
      return;
    }
  }
  
  // Set speaking flag to prevent overlaps
  isSpeaking = true;
  lastTranscript = text;
  
  try {
    console.log(chalk.cyan(isInterim ? '🔊 Converting interim to British accent:' : '🔊 Converting to British accent:'), text);
    
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { 
        languageCode: 'en-GB', 
        name: 'en-GB-Neural2-B', // British male voice
        ssmlGender: 'MALE' 
      },
      audioConfig: { 
        audioEncoding: 'LINEAR16', 
        sampleRateHertz: 24000,
        pitch: 0.0,
        speakingRate: isInterim ? 1.1 : 1.0 // Slightly faster for interim results
      },
    });
    
    // Play the synthesized speech
    speaker.write(response.audioContent);
    
    // Reset speaking flag after a short delay to allow audio to finish
    setTimeout(() => {
      isSpeaking = false;
    }, isInterim ? 300 : 500); // Shorter delay for interim results
  } catch (error) {
    console.error(chalk.red('✗ Error synthesizing speech:'), error.message);
    isSpeaking = false;
  }
}

// Start capturing and processing
function startProcessing() {
  console.log(chalk.green('✓ Starting microphone capture...'));
  
  // Check audio devices
  const devices = getAudioDevices();
  if (devices) {
    console.log(chalk.blue('Available audio devices:'));
    console.log(devices);
  }
  
  try {
    // Create a microphone instance with error handling
    micInstance = new Mic(micOptions);
    const micStream = micInstance.startRecording();
    
    micStream.on('error', (error) => {
      console.error(chalk.red('✗ Microphone error:'), error.message);
      
      if (error.message.includes('ENOENT') || error.message.includes('device')) {
        console.error(chalk.yellow('Please check your microphone connection.'));
        console.error(chalk.yellow('If using a headset, ensure it is properly connected and selected as the default input device.'));
      }
      
      cleanup();
    });
    
    // Initialize speech recognition stream
    recognizeStream = sttClient.streamingRecognize(sttRequest)
      .on('data', (data) => {
        if (!data.results || !data.results[0]) return;
        
        const result = data.results[0];
        const transcript = result.alternatives[0].transcript;
        
        // If this is an interim result, show with different formatting and process it
        if (!result.isFinal) {
          process.stdout.write(`\r${chalk.grey('Listening: ' + transcript)}`);
          transcriptBuffer = transcript;
          
          // Process interim results that are substantial enough
          if (transcript.length > 10 && (!lastTranscript || transcript.length - lastTranscript.length > 5)) {
            synthesizeBritishVoice(transcript, true);
          }
        } else {
          // Clear the interim result line
          process.stdout.write('\r' + ' '.repeat(80) + '\r');
          
          // Log the final transcript
          console.log(chalk.green('🎤 Transcribed:'), transcript);
          
          // Synthesize speech
          synthesizeBritishVoice(transcript, false);
        }
      })
      .on('error', (error) => {
        console.error(chalk.red('✗ Recognition error:'), error.message);
      })
      .on('end', () => {
        console.log(chalk.yellow('Speech recognition stream closed'));
      });
    
    // Pipe microphone data to the recognizer
    micStream.pipe(recognizeStream);
  } catch (error) {
    console.error(chalk.red('✗ Error starting audio processing:'), error.message);
    
    if (error.message.includes('ENOENT') || error.message.includes('device')) {
      console.error(chalk.yellow('Audio device error detected.'));
      console.error(chalk.yellow('Please check:'));
      console.error(chalk.yellow('1. Your headphone/microphone connection'));
      console.error(chalk.yellow('2. System audio settings'));
      console.error(chalk.yellow('3. If using Bluetooth devices, ensure they are properly paired'));
    }
    
    cleanup();
  }
}

// Cleanup function
function cleanup() {
  console.log(chalk.yellow('\nShutting down...'));
  
  // Stop microphone if running
  if (micInstance) {
    try {
      micInstance.stopRecording();
    } catch (e) {
      // Ignore errors during cleanup
      console.error(chalk.red('Error stopping microphone:'), e.message);
    }
  }
  
  // Close recognition stream if running
  if (recognizeStream) {
    try {
      recognizeStream.end();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
  
  console.log(chalk.green('✓ Cleanup complete'));
  process.exit(0);
}

// Handle program termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start the validation
startProcessing(); 