/**
 * Centralized TTS Configuration
 * Manages voice settings and audio configuration for streaming TTS services
 */

const TTS_CONFIG = {
  // Voice configuration for British accent conversion
  voice: {
    languageCode: 'en-GB',
    name: 'en-GB-Chirp3-HD-Fenrir', // High-quality British male voice
    ssmlGender: 'MALE'
  },

  // Audio configuration optimized for Twilio streaming
  streamingAudioConfig: {
    audioEncoding: 'MULAW', // Compatible with Twilio
    sampleRateHertz: 8000,  // Twilio's sample rate
    speakingRate: 1.0,      // Natural speaking speed
    pitch: 0.0,             // Neutral pitch
    volumeGainDb: 2.0       // Slightly louder for clarity
  },

  // Streaming behavior configuration
  streaming: {
    keepaliveIntervalMs: 3000,     // Send keepalive every 3 seconds
    keepaliveThresholdMs: 2000,    // Send keepalive if no activity for 2 seconds
    maxReconnectAttempts: 3,       // Maximum reconnection attempts
    reconnectBackoffMs: 1000,      // Base backoff time for reconnections
    maxInactiveTimeMs: 5 * 60 * 1000, // 5 minutes max inactive time
    textOptimization: true         // Enable text optimization for better prosody
  },

  // Alternative voice options (for fallback or customization)
  alternativeVoices: {
    'en-GB-Neural2-B': {
      languageCode: 'en-GB',
      name: 'en-GB-Neural2-B',
      ssmlGender: 'MALE',
      description: 'More stable Neural2 voice'
    },
    'en-GB-Neural2-A': {
      languageCode: 'en-GB',
      name: 'en-GB-Neural2-A',
      ssmlGender: 'FEMALE',
      description: 'British female voice'
    }
  }
};

/**
 * Get the default TTS configuration
 * @returns {Object} Default configuration object
 */
function getDefaultConfig() {
  return {
    voice: { ...TTS_CONFIG.voice },
    streamingAudioConfig: { ...TTS_CONFIG.streamingAudioConfig }
  };
}

/**
 * Get configuration with custom voice
 * @param {string} voiceName - Name of the voice to use
 * @returns {Object} Configuration with specified voice
 */
function getConfigWithVoice(voiceName) {
  const voice = TTS_CONFIG.alternativeVoices[voiceName] || TTS_CONFIG.voice;
  return {
    voice: { ...voice },
    streamingAudioConfig: { ...TTS_CONFIG.streamingAudioConfig }
  };
}

/**
 * Merge custom options with default configuration
 * @param {Object} customOptions - Custom configuration options
 * @returns {Object} Merged configuration
 */
function mergeConfig(customOptions = {}) {
  const defaultConfig = getDefaultConfig();
  
  return {
    voice: { ...defaultConfig.voice, ...customOptions.voice },
    streamingAudioConfig: { 
      ...defaultConfig.streamingAudioConfig, 
      ...customOptions.streamingAudioConfig 
    }
  };
}

module.exports = {
  TTS_CONFIG,
  getDefaultConfig,
  getConfigWithVoice,
  mergeConfig
}; 