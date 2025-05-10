const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const TranscriptionService = require('../src/services/TranscriptionService');

async function testTranscription() {
  try {
    // Check if audio file path is provided
    const audioFilePath = process.argv[2];
    if (!audioFilePath) {
      console.error('Please provide the path to an audio file as an argument');
      console.error('Usage: node test-transcription.js <path-to-audio-file>');
      process.exit(1);
    }

    // Check if file exists
    if (!fs.existsSync(audioFilePath)) {
      console.error(`File not found: ${audioFilePath}`);
      process.exit(1);
    }

    // Read audio file
    const audioData = fs.readFileSync(audioFilePath);

    // Transcribe audio
    console.log('Transcribing audio with Indian English accent recognition...');
    const result = await TranscriptionService.transcribe(audioData, {
      languageCode: 'en-IN',
      encoding: 'MP3',
      sampleRateHertz: 16000
    });

    // Print results
    console.log('\nTranscription Results:');
    console.log('---------------------');
    console.log(`Transcript: ${result.transcript}`);
    console.log(`Confidence: ${(result.confidence * 100).toFixed(2)}%`);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('API Error Details:', error.response.data);
    }
    process.exit(1);
  }
}

testTranscription(); 