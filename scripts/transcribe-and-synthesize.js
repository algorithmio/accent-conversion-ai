const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const TranscriptionService = require('../src/services/TranscriptionService');
const TextToSpeechService = require('../src/services/TextToSpeechService');

// Available British English voices
const BRITISH_VOICES = {
  'A': 'en-GB-Standard-A', // Female
  'B': 'en-GB-Standard-B', // Male
  'C': 'en-GB-Standard-C', // Female
  'D': 'en-GB-Standard-D', // Male
  'F': 'en-GB-Standard-F', // Female
};

async function transcribeAndSynthesize() {
  try {
    // Check if audio file path is provided
    const audioFilePath = process.argv[2];
    if (!audioFilePath) {
      console.error('Please provide the path to an audio file as an argument');
      console.error('Usage: node transcribe-and-synthesize.js <path-to-audio-file> [voice-option]');
      console.error('\nAvailable British voice options:');
      console.error('A - Female (default)');
      console.error('B - Male');
      console.error('C - Female');
      console.error('D - Male');
      console.error('F - Female');
      process.exit(1);
    }

    // Check if file exists
    if (!fs.existsSync(audioFilePath)) {
      console.error(`File not found: ${audioFilePath}`);
      process.exit(1);
    }

    // Get voice option (default to 'A' if not provided)
    const voiceOption = (process.argv[3] || 'A').toUpperCase();
    const voiceName = BRITISH_VOICES[voiceOption] || BRITISH_VOICES['A'];

    // Read audio file
    const audioData = fs.readFileSync(audioFilePath);

    // Step 1: Transcribe audio
    console.log('Transcribing audio with Indian English accent recognition...');
    const transcriptionResult = await TranscriptionService.transcribe(audioData, {
      languageCode: 'en-IN',
      encoding: 'MP3',
      sampleRateHertz: 16000
    });

    // Print transcription results
    console.log('\nTranscription Results:');
    console.log('---------------------');
    console.log(`Full Transcript: ${transcriptionResult.transcript}`);
    console.log(`Overall Confidence: ${(transcriptionResult.confidence * 100).toFixed(2)}%`);

    // Step 2: Convert transcript to speech with British accent
    console.log('\nConverting transcript to British English speech...');
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFileName = `british_${Date.now()}.mp3`;
    const outputPath = path.join(outputDir, outputFileName);

    await TextToSpeechService.synthesize(transcriptionResult.transcript, {
      voiceName: voiceName,
      outputFile: outputPath
    });

    console.log('\nSynthesis Results:');
    console.log('-----------------');
    console.log(`Voice used: ${voiceName}`);
    console.log(`Audio file saved to: ${outputPath}`);

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('API Error Details:', error.response.data);
    }
    process.exit(1);
  }
}

transcribeAndSynthesize(); 