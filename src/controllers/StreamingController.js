const speechService = require('../services/SpeechService');

class StreamingController {
  constructor() {
    if (StreamingController.instance) {
      return StreamingController.instance;
    }
    
    this.activeStreams = new Map();
    StreamingController.instance = this;
  }

  /**
   * Initializes streaming functionality for a socket connection
   * @param {Object} io - Socket.io server instance
   */
  initializeSocketHandlers(io) {
    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);
      
      // Handle start streaming event
      socket.on('startStreaming', () => {
        this.startStreaming(socket);
      });
      
      // Handle audio data event
      socket.on('audioData', (data) => {
        this.processAudioData(socket, data);
      });
      
      // Handle stop streaming event
      socket.on('stopStreaming', () => {
        this.stopStreaming(socket);
      });
      
      // Handle disconnect
      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        this.stopStreaming(socket);
      });
    });
  }

  /**
   * Starts a streaming session for a client
   * @param {Object} socket - Socket connection
   */
  startStreaming(socket) {
    try {
      console.log('Starting streaming for client:', socket.id);
      
      // Store session data for the socket
      const streamData = {
        currentTranscription: '',
        isFinal: false,
        processingQueue: Promise.resolve(),
        isProcessing: false,
        audioBuffer: Buffer.alloc(0) // Initialize empty buffer for audio collection
      };
      
      this.activeStreams.set(socket.id, streamData);
            
      // Emit ready event to client
      socket.emit('streamingReady');
      
    } catch (error) {
      console.error('Error starting streaming:', error);
      this.handleApiError(socket, error);
    }
  }

  /**
   * Handle API errors with more detailed messages for authentication issues
   * @param {Object} socket - Socket connection
   * @param {Error} error - The error object
   */
  handleApiError(socket, error) {
    console.error('API Error details:', error);
    
    let errorMessage = 'An error occurred during processing';
    let errorDetails = error.message;
    
    // Check for common authentication errors
    if (error.message && error.message.includes('API key')) {
      errorMessage = 'Google API key authentication error';
      errorDetails = 'Please check that your API key is valid and has access to the necessary APIs';
      console.error('API KEY AUTHENTICATION ERROR: Please verify your API key is correct in .env file');
    } else if (error.message && error.message.includes('not enabled')) {
      errorMessage = 'Google API service not enabled';
      errorDetails = 'Please enable the required APIs (Speech-to-Text and Text-to-Speech) in your Google Cloud Console';
      console.error('API SERVICE NOT ENABLED: You need to enable the APIs in Google Cloud Console');
    } else if (error.message && error.message.includes('permission')) {
      errorMessage = 'Permission denied';
      errorDetails = 'The API key does not have permission to access the required services';
      console.error('PERMISSION DENIED: Check API key permissions in Google Cloud Console');
    }
    
    socket.emit('error', { 
      message: errorMessage, 
      details: errorDetails 
    });
  }

  /**
   * Processes audio data from client
   * @param {Object} socket - Socket connection
   * @param {Object} data - Audio data
   */
  async processAudioData(socket, data) {
    try {
      const streamData = this.activeStreams.get(socket.id);
      if (!streamData) {
        console.error('No active stream for client:', socket.id);
        return;
      }
      
      // Convert base64 to buffer
      const audioBuffer = Buffer.from(data.audio, 'base64');
      
      // Accumulate audio data
      streamData.audioBuffer = Buffer.concat([streamData.audioBuffer, audioBuffer]);
      
      // Only process if not already processing and we have enough data
      if (!streamData.isProcessing && streamData.audioBuffer.length > 4000) {
        streamData.isProcessing = true;
        
        // Process accumulated audio
        const bufferToProcess = streamData.audioBuffer;
        streamData.audioBuffer = Buffer.alloc(0); // Reset buffer
        
        try {
          // Recognize speech in the audio buffer
          const result = await speechService.recognizeSpeech(bufferToProcess);
          
          if (result && result.transcript) {
            // Emit the transcript to the client
            socket.emit('transcript', {
              text: result.transcript,
              isFinal: result.isFinal
            });
            
            // Update current transcription
            streamData.currentTranscription = result.transcript;
            streamData.isFinal = result.isFinal;
            
            // If this is a final result, convert to speech with British accent
            if (result.isFinal && result.transcript.trim() !== '') {
              // Use the processing queue to ensure order
              streamData.processingQueue = streamData.processingQueue
                .then(() => this.convertToSpeech(socket, result.transcript))
                .catch(err => {
                  console.error('Error processing final transcript:', err);
                  this.handleApiError(socket, err);
                });
            }
          }
        } catch (error) {
          console.error('Error processing audio:', error);
          this.handleApiError(socket, error);
        } finally {
          streamData.isProcessing = false;
        }
      }
    } catch (error) {
      console.error('Error processing audio data:', error);
      this.handleApiError(socket, error);
    }
  }

  /**
   * Converts text to speech with British accent and sends to client
   * @param {Object} socket - Socket connection
   * @param {string} text - Text to convert
   */
  async convertToSpeech(socket, text) {
    try {
      // Skip if text is empty
      if (!text || text.trim() === '') {
        return;
      }
      
      // Convert text to speech with British accent
      const audioContent = await speechService.convertTextToSpeechStream(text);
      
      // Send audio to client
      socket.emit('audioResult', {
        audio: audioContent.toString('base64'),
        text
      });
      
    } catch (error) {
      console.error('Error converting to speech:', error);
      this.handleApiError(socket, error);
    }
  }

  /**
   * Stops streaming for a client
   * @param {Object} socket - Socket connection
   */
  stopStreaming(socket) {
    try {
      const streamData = this.activeStreams.get(socket.id);
      if (streamData) {
        console.log('Stopping streaming for client:', socket.id);
        
        // Remove from active streams
        this.activeStreams.delete(socket.id);
      }
    } catch (error) {
      console.error('Error stopping streaming:', error);
    }
  }
}

module.exports = new StreamingController(); 