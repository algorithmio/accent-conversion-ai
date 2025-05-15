const streamingAccentService = require('../services/StreamingAccentService');

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
      console.log('Starting streaming accent conversion for client:', socket.id);
      
      // Create streaming session with callbacks
      const streamingSession = streamingAccentService.createStreamingSession(
        // Transcription callback
        (transcriptionData) => {
          socket.emit('transcript', transcriptionData);
        },
        // Audio result callback
        (audioData) => {
          socket.emit('audioResult', audioData);
        },
        // Error callback
        (error) => {
          this.handleApiError(socket, error);
        }
      );
      
      if (streamingSession) {
        // Store session for this socket
        this.activeStreams.set(socket.id, {
          streamingSession,
          isActive: true
        });
        
        // Emit ready event to client
        socket.emit('streamingReady');
      } else {
        socket.emit('error', { 
          message: 'Failed to start streaming session', 
          details: 'Could not initialize speech recognition' 
        });
      }
            
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
   * Processes audio data from client and sends it to the streaming session
   * @param {Object} socket - Socket connection
   * @param {Object} data - Audio data (in base64 format)
   */
  processAudioData(socket, data) {
    try {
      const streamData = this.activeStreams.get(socket.id);
      if (!streamData || !streamData.isActive) {
        console.error('No active stream for client:', socket.id);
        return;
      }
      
      // Convert base64 to buffer
      const audioBuffer = Buffer.from(data.audio, 'base64');
      
      // Send audio data to streaming session
      streamData.streamingSession.writeAudio(audioBuffer);
      
    } catch (error) {
      console.error('Error processing audio data:', error);
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
      if (streamData && streamData.isActive) {
        console.log('Stopping streaming for client:', socket.id);
        
        // Close the streaming session
        if (streamData.streamingSession) {
          streamData.streamingSession.close();
        }
        
        // Mark as inactive
        streamData.isActive = false;
        
        // Remove from active streams
        this.activeStreams.delete(socket.id);
      }
    } catch (error) {
      console.error('Error stopping streaming:', error);
    }
  }
}

module.exports = new StreamingController(); 