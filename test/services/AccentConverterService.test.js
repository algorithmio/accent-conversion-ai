const AccentConverterService = require('../../src/services/AccentConverterService');

// Mock the Google Cloud TTS client
jest.mock('@google-cloud/text-to-speech', () => {
  return {
    TextToSpeechClient: jest.fn().mockImplementation(() => {
      return {
        synthesizeSpeech: jest.fn().mockResolvedValue([
          {
            audioContent: Buffer.from('mock-audio-content')
          }
        ])
      };
    })
  };
});

// Mock the fs module
jest.mock('fs', () => {
  return {
    existsSync: jest.fn().mockReturnValue(false),
    mkdirSync: jest.fn(),
    writeFile: jest.fn((path, data, callback) => callback(null))
  };
});

// Mock the logger
jest.mock('../../src/utils/logger', () => {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  };
});

describe('AccentConverterService', () => {
  let accentConverter;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Set environment variable for testing
    process.env.GOOGLE_API_KEY = 'test-api-key';
    
    // Get instance of service
    accentConverter = AccentConverterService.getInstance();
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.GOOGLE_API_KEY;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = AccentConverterService.getInstance();
      const instance2 = AccentConverterService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('convertTextToBritishAccent', () => {
    it('should convert text to British accent', async () => {
      const text = 'Hello, this is a test';
      const result = await accentConverter.convertTextToBritishAccent(text);
      
      expect(result).toEqual(Buffer.from('mock-audio-content'));
      expect(accentConverter.ttsClient.synthesizeSpeech).toHaveBeenCalledWith({
        input: { text },
        voice: { 
          languageCode: 'en-GB', 
          name: 'en-GB-Neural2-B',
          ssmlGender: 'MALE' 
        },
        audioConfig: { 
          audioEncoding: 'MP3',
          sampleRateHertz: 24000,
          pitch: 0.0,
          speakingRate: 1.0
        },
      });
    });

    it('should handle empty text', async () => {
      const result = await accentConverter.convertTextToBritishAccent('');
      
      expect(result).toBeNull();
      expect(accentConverter.ttsClient.synthesizeSpeech).not.toHaveBeenCalled();
    });

    it('should handle errors from TTS service', async () => {
      // Mock TTS to throw an error
      accentConverter.ttsClient.synthesizeSpeech.mockRejectedValueOnce(new Error('TTS error'));
      
      const text = 'Hello, this is a test';
      const result = await accentConverter.convertTextToBritishAccent(text);
      
      expect(result).toBeNull();
    });
  });

  describe('saveAudioToFile', () => {
    it('should save audio to a file', async () => {
      const audioBuffer = Buffer.from('test-audio-data');
      const filename = 'test.mp3';
      
      const result = await accentConverter.saveAudioToFile(audioBuffer, filename);
      
      expect(result).toContain(filename);
    });
  });
}); 