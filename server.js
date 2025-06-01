require("dotenv").config();
const express = require("express");
const expressWs = require("express-ws");
const VoiceResponse = require("twilio").twiml.VoiceResponse;
const textToSpeech = require("@google-cloud/text-to-speech");
const path = require("path");
const fs = require("fs");

// Import the streaming services
const StreamingAccentConverterV2 = require("./src/services/StreamingAccentConverterV2");
const DeepgramStreamingService = require("./src/services/DeepgramStreamingService");
const { TTS_CONFIG } = require("./src/config/tts-config");

const PORT = process.env.PORT || 4001;

// Initialize Express app with WebSocket support
const app = express();
const server = require("http").createServer(app);
expressWs(app, server);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Initialize TTS client
let ttsClient;
// Add a global cache for TTS results to speed up repeated conversions
const ttsCache = new Map();
// Store active connections
const activeConnections = new Map();

const credentialsPath = path.join(__dirname, "config/creds.json");

if (fs.existsSync(credentialsPath)) {
  console.log("✅ Using Google Cloud credentials from config/creds.json");
  ttsClient = new textToSpeech.TextToSpeechClient({
    keyFilename: credentialsPath,
  });
} else {
  console.log("❌ No credentials file found at config/creds.json");
  console.log(
    "📝 Please create config/creds.json with your Google Cloud service account credentials"
  );
  process.exit(1);
}

// Initialize streaming services
let streamingAccentConverter = new StreamingAccentConverterV2();
let deepgramService = new DeepgramStreamingService();

// Setup error handling for streaming services
streamingAccentConverter.on("error", (errorData) => {
  console.error(
    `❌ StreamingAccentConverter error for session ${errorData.sessionId}:`,
    errorData.error.message
  );
});

deepgramService.on("error", (errorData) => {
  console.error(
    `❌ DeepgramStreamingService error for session ${errorData.sessionId}:`,
    errorData.error.message
  );
});

// Handle incoming voice calls
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;
  console.log(`Incoming call: ${callSid}`);

  const twiml = new VoiceResponse();

  // Brief welcome
  twiml.say("Welcome to Accent Conversion AI. Speak now.");

  // Use Connect Stream for bidirectional streaming
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.get("host")}/stream`,
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

// WebSocket endpoint for media streaming
app.ws("/stream", (ws, req) => {
  let conversionState = { current: 0 };
  ws.conversionState = conversionState;

  let callSid = null;
  let streamSid = null;
  let deepgramSession = null;
  let audioChunks = [];
  let streamDestroyed = false;
  let lastConvertedText = "";
  let lastConversionTime = 0;
  let isCurrentlySpeaking = false;
  let lastSpeechTime = 0;
  let conversationHistory = [];
  let lastAudioSentTime = 0;
  let previousInterimText = "";
  let isInitialPhaseComplete = false;
  let firstAudioChunkSent = false;
  
  // Enhanced tracking for better accuracy
  let completedSentences = new Set(); // Track completed final sentences
  let currentSentenceBuffer = ""; // Buffer for current sentence being built
  let lastSentTimestamp = 0;
  let interimBuffer = ""; // Track interim progress
  let pendingContent = ""; // Track content waiting to be sent
  let cumulativeSentContent = ""; // Track all content sent for current speech segment

  // Streaming TTS session
  let streamingSession = null;

  // Handle Deepgram transcription results
  function handleDeepgramTranscription(data) {
    const { transcript, isFinal, words, confidence } = data;
    
    // Update speech activity tracking
    lastSpeechTime = Date.now();
    isCurrentlySpeaking = true;

    if (isFinal) {
      handleFinalTranscript(transcript);
    } else {
      handleInterimTranscript(transcript);
    }
  }

  // Reset state when a speech segment ends
  function resetSegmentState() {
    isInitialPhaseComplete = false;
    interimBuffer = "";
    currentSentenceBuffer = "";
    previousInterimText = "";
    cumulativeSentContent = ""; // Reset cumulative tracking
  }

  // Handle final transcript with robust deduplication
  async function handleFinalTranscript(transcript) {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;

    // Create unique identifier for this sentence
    const sentenceId = generateSentenceId(cleanTranscript);
    
    // Skip if we've already processed this exact sentence
    if (completedSentences.has(sentenceId)) {
      return;
    }

    // Mark as completed
    completedSentences.add(sentenceId);
    
    // Clean up old completed sentences (keep only last 10)
    if (completedSentences.size > 10) {
      const oldestIds = Array.from(completedSentences).slice(0, -10);
      oldestIds.forEach(id => completedSentences.delete(id));
    }

    // For final transcript, compare against cumulative content sent during interim processing
    const newContent = extractNewContent(cleanTranscript, cumulativeSentContent);
    
    if (newContent && newContent.trim()) {
      // Update tracking to include the complete final transcript
      lastConvertedText = cleanTranscript;
      cumulativeSentContent = cleanTranscript;
      await sendToTTS(newContent, true);
    } else {
      // Update tracking even if no new content
      lastConvertedText = cleanTranscript;
      cumulativeSentContent = cleanTranscript;
    }

    // Reset interim state for next segment
    resetSegmentState();
  }

  // Handle interim transcript with immediate response
  async function handleInterimTranscript(transcript) {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;

    // Phase 1: Immediate response for first words (faster than before)
    if (!isInitialPhaseComplete) {
      // Start processing immediately with first meaningful content
      const words = cleanTranscript.split(/\s+/);
      if (words.length >= 1) { // Immediate processing
        isInitialPhaseComplete = true;
        interimBuffer = cleanTranscript;
        currentSentenceBuffer = cleanTranscript;
        cumulativeSentContent = cleanTranscript; // Start tracking cumulative content
        
        await sendToTTS(cleanTranscript, false);
        return;
      }
    }

    // Phase 2: Stream incremental additions
    const newContent = extractNewContent(cleanTranscript, interimBuffer);
    
    if (newContent && newContent.trim()) {
      interimBuffer = cleanTranscript;
      currentSentenceBuffer = cleanTranscript;
      
      // Update cumulative tracking with the new content
      if (cumulativeSentContent) {
        // Only add the new part to cumulative content
        cumulativeSentContent = cleanTranscript;
      } else {
        cumulativeSentContent = newContent;
      }
      
      // Send new content immediately for responsiveness
      await sendToTTS(newContent, false);
    }
  }

  // Improved text extraction with better accuracy
  function extractNewContent(currentText, previousText) {
    if (!previousText || previousText.trim() === "") {
      return currentText;
    }

    // Normalize texts for comparison
    const currentWords = currentText.trim().split(/\s+/);
    const previousWords = previousText.trim().split(/\s+/);

    // Find longest common prefix using word-level comparison
    let commonPrefixLength = 0;
    const minLength = Math.min(currentWords.length, previousWords.length);

    for (let i = 0; i < minLength; i++) {
      const currentWord = normalizeWord(currentWords[i]);
      const previousWord = normalizeWord(previousWords[i]);

      if (currentWord === previousWord && currentWord !== "") {
        commonPrefixLength = i + 1;
      } else {
        break;
      }
    }

    // Handle different scenarios
    if (currentWords.length <= previousWords.length) {
      // Text might be corrected or shortened
      if (commonPrefixLength < currentWords.length) {
        // Return the corrected portion
        return currentWords.slice(commonPrefixLength).join(" ");
      }
      return ""; // No new content
    }

    // Text is longer - extract new words
    const newWords = currentWords.slice(commonPrefixLength);
    return newWords.length > 0 ? newWords.join(" ") : "";
  }

  // Normalize words for accurate comparison
  function normalizeWord(word) {
    return word.toLowerCase()
      .replace(/[^\w'-]/g, "") // Keep apostrophes and hyphens
      .trim();
  }

  // Generate unique ID for sentences to prevent duplicates
  function generateSentenceId(text) {
    // Create a stable hash-like ID based on normalized text
    const normalized = text.toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    
    // Simple hash function for sentence identification
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `${hash}_${normalized.length}`;
  }

  // Send content to TTS with proper routing
  async function sendToTTS(content, isFinal) {
    if (!content || !content.trim()) return;

    const cleanContent = content.trim();
    
    // Update tracking
    lastConversionTime = Date.now();

    try {
      if (streamingSession && streamingSession.isActive()) {
        // Use streaming TTS
        streamingSession.addText(cleanContent);
      } else {
        // Fallback to legacy TTS
        await convertAndSendAudio(cleanContent, ws, streamSid, Date.now(), isFinal);
        lastAudioSentTime = Date.now();
      }
    } catch (error) {
      // Silent error handling
    }
  }

  ws.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case "start":
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;

          activeConnections.set(callSid, { ws, streamSid });

          // Create Deepgram streaming session
          try {
            deepgramSession = deepgramService.createStreamingSession(callSid);
            deepgramService.on('transcription', handleDeepgramTranscription);
          } catch (error) {
            console.error(`❌ Error creating Deepgram session:`, error);
            streamDestroyed = true;
          }

          // Initialize streaming TTS session if enabled
          if (streamingAccentConverter) {
            try {
              streamingSession = streamingAccentConverter.createSession(
                callSid,
                streamSid,
                ws
              );

              // Setup fallback mechanism for streaming failures
              streamingSession.fallbackToLegacy = false;
            } catch (error) {
              streamingSession = null;
            }
          }

          break;

        case "media":
          if (deepgramSession && !streamDestroyed && msg.media && msg.media.payload) {
            const audioData = Buffer.from(msg.media.payload, "base64");

            if (!firstAudioChunkSent) {
              try {
                deepgramSession.send(audioData);
                firstAudioChunkSent = true;
              } catch (error) {
                streamDestroyed = true;
                audioChunks.push(audioData);
              }
            } else {
              audioChunks.push(audioData);
              // Reduced batch size for faster response
              if (audioChunks.length >= 3) { // Reduced from 5 to 3
                const combinedAudio = Buffer.concat(audioChunks);
                audioChunks = [];

                try {
                  if (deepgramSession && !streamDestroyed) {
                    deepgramSession.send(combinedAudio);
                    lastAudioSentTime = Date.now();
                  } else {
                    audioChunks.unshift(combinedAudio);
                  }
                } catch (error) {
                  audioChunks.unshift(combinedAudio);
                  streamDestroyed = true;
                }
              }
            }
          }
          break;

        case "stop":
          streamDestroyed = true;
          if (deepgramSession) {
            try {
              deepgramSession.close();
            } catch (error) {
              // Silent error handling
            }
          }

          // Close streaming TTS session
          if (streamingSession) {
            try {
              streamingSession.close();
            } catch (error) {
              // Silent error handling
            }
            streamingSession = null;
          }

          activeConnections.delete(callSid);

          // Cleanup inactive sessions
          if (streamingAccentConverter) {
            streamingAccentConverter.cleanupInactiveSessions();
          }
          if (deepgramService) {
            deepgramService.cleanupInactiveSessions();
          }
          break;
      }
    } catch (error) {
      // Silent error handling
    }
  });

  ws.on("close", () => {
    streamDestroyed = true;

    if (deepgramSession) {
      try {
        deepgramSession.close();
      } catch (error) {
        // Silent error handling
      }
    }

    // Close streaming TTS session
    if (streamingSession) {
      try {
        streamingSession.close();
      } catch (error) {
        // Silent error handling
      }
      streamingSession = null;
    }

    if (callSid) {
      activeConnections.delete(callSid);
    }

    // Cleanup inactive sessions
    if (streamingAccentConverter) {
      streamingAccentConverter.cleanupInactiveSessions();
    }
    if (deepgramService) {
      deepgramService.cleanupInactiveSessions();
    }
  });

  ws.on("error", (error) => {
    streamDestroyed = true;

    // Close streaming TTS session on error
    if (streamingSession) {
      try {
        streamingSession.close();
      } catch (error) {
        // Silent error handling
      }
      streamingSession = null;
    }

    // Cleanup inactive sessions
    if (streamingAccentConverter) {
      streamingAccentConverter.cleanupInactiveSessions();
    }
    if (deepgramService) {
      deepgramService.cleanupInactiveSessions();
    }
  });

  // Natural conversation decision making
  function shouldConvertNaturally(text, isFinal) {
    const cleanText = cleanForComparison(text);

    // Always convert the first message
    if (conversationHistory.length === 0) {
      return true;
    }

    // Check timing - allow more frequent conversions for natural flow
    const timeSinceLastAudio = Date.now() - lastAudioSentTime;
    const timeSinceLastConversion = Date.now() - lastConversionTime;

    // For final results, be more permissive
    if (isFinal) {
      // Allow if enough time has passed OR content is different enough
      if (timeSinceLastConversion > 3000) {
        // 3 seconds for final
        return true;
      }

      // Check if content is meaningfully different
      const lastItem = conversationHistory[conversationHistory.length - 1];
      if (lastItem) {
        const similarity = calculateSimilarity(cleanText, lastItem.cleanText);
        if (similarity < 0.8) {
          // 80% threshold - more permissive
          return true;
        } else {
          return false;
        }
      }
      return true;
    } else {
      // For interim results, be selective but not too restrictive
      if (timeSinceLastAudio < 1500) {
        // 1.5 seconds minimum for interim
        return false;
      }

      // Check for natural speech patterns
      const hasNaturalBreak =
        /[.!?]$/.test(text.trim()) ||
        /\b(and|but|so|because|however|also|now|then|actually)\b/i.test(text);

      if (!hasNaturalBreak && text.split(" ").length < 8) {
        return false;
      }

      // Check similarity with recent history
      const recentItems = conversationHistory.slice(-2); // Last 2 items
      for (const item of recentItems) {
        const similarity = calculateSimilarity(cleanText, item.cleanText);
        if (similarity > 0.75) {
          // 75% threshold for interim
          return false;
        }
      }

      return true;
    }
  }

  // Clean text for comparison
  function cleanForComparison(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, "") // Remove punctuation
      .replace(/\s+/g, " ") // Normalize spaces
      .trim();
  }

  // Calculate similarity between two texts
  function calculateSimilarity(text1, text2) {
    const words1 = text1.split(" ");
    const words2 = text2.split(" ");

    // Use Jaccard similarity for better semantic comparison
    const set1 = new Set(words1);
    const set2 = new Set(words2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    activeConnections: activeConnections.size,
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: https://your-ngrok-url.ngrok.io/voice`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Function to convert text to British accent and send back
async function convertAndSendAudio(text, ws, streamSid, startTime, isFinal) {
  try {
    // Mark this conversion request with a unique ID for cancellation of outdated conversions
    const currentConversionId = ++ws.conversionState.current;
    const conversionStartTime = Date.now();

    // Check if WebSocket is still open
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    // Check if TTS result is cached
    if (ttsCache.has(text)) {
      if (currentConversionId !== ws.conversionState.current) {
        return;
      }
      const cachedAudioContent = ttsCache.get(text);
      const audioBase64 = cachedAudioContent.toString("base64");
      const mediaMessage = {
        event: "media",
        streamSid: streamSid,
        media: {
          payload: audioBase64,
        },
      };
      ws.send(JSON.stringify(mediaMessage));
      return;
    }

    // Convert to British English speech with optimized settings
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: TTS_CONFIG.voice,
      audioConfig: TTS_CONFIG.streamingAudioConfig,
    });

    if (response.audioContent && ws.readyState === ws.OPEN) {
      if (currentConversionId !== ws.conversionState.current) {
        return;
      }
      // Cache the TTS result for future requests
      ttsCache.set(text, response.audioContent);

      // Send the audio as one message for smooth playback
      const audioBase64 = response.audioContent.toString("base64");

      const mediaMessage = {
        event: "media",
        streamSid: streamSid,
        media: {
          payload: audioBase64,
        },
      };

      try {
        ws.send(JSON.stringify(mediaMessage));
      } catch (wsError) {
        // Silent error handling
      }
    }
  } catch (error) {
    // Silent error handling
  }
}
