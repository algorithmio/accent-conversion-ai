require("dotenv").config();
const express = require("express");
const expressWs = require("express-ws");
const VoiceResponse = require("twilio").twiml.VoiceResponse;
const speech = require("@google-cloud/speech").v1p1beta1;
const textToSpeech = require("@google-cloud/text-to-speech");
const path = require("path");
const fs = require("fs");

// Import the new streaming accent converter
const StreamingAccentConverterV2 = require("./src/services/StreamingAccentConverterV2");
const { TTS_CONFIG } = require("./src/config/tts-config");

// Initialize Express app with WebSocket support
const app = express();
const server = require("http").createServer(app);
expressWs(app, server);
const PORT = process.env.PORT || 4001;

// Initialize Google Cloud clients
let sttClient, ttsClient;

try {
  const credentialsPath = path.join(__dirname, "config/creds.json");

  if (fs.existsSync(credentialsPath)) {
    console.log("✅ Using Google Cloud credentials from config/creds.json");
    sttClient = new speech.SpeechClient({ keyFilename: credentialsPath });
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
} catch (error) {
  console.error("❌ Error initializing Google Cloud clients:", error.message);
  console.log("📝 Please check your config/creds.json file format");
  process.exit(1);
}

// Add a global cache for TTS results to speed up repeated conversions
const ttsCache = new Map();

// Prewarm the TTS client to reduce first-call latency
ttsClient.synthesizeSpeech({
  input: { text: 'warmup' },
  voice: {
    languageCode: "en-GB",
    name: "en-GB-Neural2-B",
    ssmlGender: "MALE",
  },
  audioConfig: {
    audioEncoding: "MULAW",
    sampleRateHertz: 8000,
    speakingRate: 1.0,
    pitch: 0.0,
    volumeGainDb: 2.0,
  },
}).then(() => {
  console.log("TTS client warmed up");
}).catch((err) => {
  console.error("TTS warmup failed", err);
});

// Initialize streaming accent converter if enabled
let streamingAccentConverter;
try {
  streamingAccentConverter = new StreamingAccentConverterV2();
  console.log("🎵 Streaming TTS enabled - using StreamingAccentConverterV2");

  // Setup error handling for streaming converter
  streamingAccentConverter.on("error", (errorData) => {
    console.error(
      `❌ StreamingAccentConverter error for session ${errorData.sessionId}:`,
      errorData.error.message
    );
  });

  streamingAccentConverter.on("sessionClosed", (data) => {
    console.log(
      `📊 StreamingAccentConverter session ${data.callSid} closed:`,
      data.metrics
    );
  });

  // Setup cleanup interval for inactive sessions
  setInterval(() => {
    streamingAccentConverter.cleanupInactiveSessions();
  }, Math.min(60000, TTS_CONFIG.streaming.maxInactiveTimeMs / 5)); // Check every minute or 1/5 of max inactive time, whichever is smaller
} catch (error) {
  console.error(
    "❌ Error initializing StreamingAccentConverterV2:",
    error.message
  );
  console.log("⚠️  Falling back to legacy TTS implementation");
  streamingAccentConverter = null;
}

// Configure middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Store active connections
const activeConnections = new Map();

// Handle incoming voice calls
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;
  console.log(`Incoming call: ${callSid}`);

  const twiml = new VoiceResponse();

  // Brief welcome
  twiml.say("Welcome to Accent Converter AI. Speak now.");

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
  console.log("New WebSocket connection");
  let conversionState = { current: 0 };
  ws.conversionState = conversionState;

  let callSid = null;
  let streamSid = null;
  let recognizeStream = null;
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
  let firstAudioChunkSentToStt = false;

  // Streaming TTS session
  let streamingSession = null;

  // Function to create a new recognition stream
  function createRecognitionStream() {
    if (recognizeStream && !streamDestroyed) {
      try {
        recognizeStream.end();
      } catch (error) {
        console.log("Error ending previous stream:", error.message);
      }
    }

    streamDestroyed = false;

    recognizeStream = sttClient.streamingRecognize({
      config: {
        encoding: "MULAW",
        sampleRateHertz: 8000,
        languageCode: "en-IN",
        model: "telephony",
        useEnhanced: true,
        enableAutomaticPunctuation: true,
      },
      interimResults: true, // Enable interim results for real-time feedback
    });

    recognizeStream.on("data", async (data) => {
      const sttDataReceivedTime = Date.now(); // Timestamp for STT data reception
      if (data.results && data.results[0] && data.results[0].alternatives[0]) {
        console.log(`[${new Date().toISOString()}] STT data received (processing took ${sttDataReceivedTime - lastAudioSentTime}ms since last audio batch sent)`); // Crude latency check
        console.log("data", data.results[0].alternatives[0]);
        const transcript = data.results[0].alternatives[0].transcript;
        const isFinal = data.results[0].isFinal;
        const confidence = data.results[0].alternatives[0].confidence;

        // Update speech activity tracking
        lastSpeechTime = Date.now();
        isCurrentlySpeaking = true;

        // Log all transcriptions with timing
        const timestamp = new Date().toISOString();
        console.log(
          `[${timestamp}] ${
            isFinal ? "🔴 FINAL" : "🟡 INTERIM"
          }: "${transcript}" (confidence: ${
            confidence ? confidence.toFixed(2) : "N/A"
          })`
        );

        if (isFinal) {
          // Reset for next speech segment
          const fullFinalTranscript = transcript; // Store the complete final transcript
          previousInterimText = ""; // Reset previousInterimText as we are processing a final
          isInitialPhaseComplete = false;

          // Process final result if it's meaningful
          if (
            fullFinalTranscript &&
            fullFinalTranscript.trim() &&
            confidence &&
            confidence > 0.7
          ) {
            // Compare the full final transcript with the last *successfully converted* text
            // This ensures we only process truly new information or significant corrections
            const newContent = extractNewContentAdvanced(
              fullFinalTranscript,
              lastConvertedText
            );

            if (newContent && newContent.trim()) {
              console.log(
                `🎯 FINAL NEW CONTENT (vs lastConvertedText): "${newContent}"`
              );
              lastConvertedText = fullFinalTranscript; // Update lastConvertedText with the full final transcript

              if (streamingSession) {
                // Use streaming TTS with fallback
                try {
                  if (streamingSession.isActive()) {
                    streamingSession.addText(newContent);
                  } else {
                    console.log(
                      `⚠️  Streaming session not active for final result, falling back to legacy TTS`
                    );
                    await processIncrementalContent(newContent, true);
                  }
                } catch (error) {
                  console.error(
                    `❌ Error sending final result to streaming TTS, falling back to legacy:`,
                    error.message
                  );
                  await processIncrementalContent(newContent, true);
                }
              } else {
                // Use legacy TTS
                await processIncrementalContent(newContent, true);
              }
            } else {
              console.log(
                `🔄 No new content in final result when compared against last successfully converted text. Final: "${fullFinalTranscript}", LastConverted: "${lastConvertedText}"`
              );
              // Even if no new content for TTS, update lastConvertedText to the latest final transcript
              // to prevent issues with the next interim/final phrases.
              lastConvertedText = fullFinalTranscript;
            }
          }
        } else {
          // Handle interim results with incremental algorithm
          if (transcript && transcript.trim()) {
            if (streamingSession) {
              // Use streaming TTS for interim results
              await handleStreamingInterim(transcript);
            } else {
              // Use legacy incremental processing
              await handleIncrementalInterim(transcript);
            }
          }
        }
      }
    });

    // Monitor speech activity for natural pauses
    setInterval(() => {
      if (isCurrentlySpeaking && Date.now() - lastSpeechTime > 2000) {
        isCurrentlySpeaking = false;
        console.log(`🤫 Natural speech pause detected`);
      }
    }, 1000);

    recognizeStream.on("error", (error) => {
      console.error("Recognition error:", error.message);
      streamDestroyed = true;

      // Recreate stream after a delay if connection is still active
      setTimeout(() => {
        if (activeConnections.has(callSid) && !streamDestroyed) {
          console.log("Recreating recognition stream...");
          createRecognitionStream();
        }
      }, 2000);
    });

    recognizeStream.on("end", () => {
      console.log("Recognition stream ended");
      streamDestroyed = true;
    });

    recognizeStream.on("close", () => {
      console.log("Recognition stream closed");
      streamDestroyed = true;
    });

    return recognizeStream;
  }

  // Handle streaming interim results for streaming TTS
  async function handleStreamingInterim(transcript) {
    // Check if streaming session is still available
    if (!streamingSession || !streamingSession.isActive()) {
      console.log(
        `⚠️  Streaming session unavailable, falling back to legacy TTS for: "${transcript}"`
      );
      await handleIncrementalInterim(transcript);
      return;
    }

    const words = transcript.trim().split(" ");

    // Phase 1: Wait for initial 3-4 words to establish context
    if (!isInitialPhaseComplete) {
      // wordBuffer = words; // wordBuffer seems unused for gating logic now

      if (words.length >= 1) { // Changed from 3 to 1 for faster initial response
        isInitialPhaseComplete = true;
        previousInterimText = transcript;

        console.log(`🚀 STREAMING INITIAL PHASE COMPLETE: "${transcript}" (${words.length} word(s))`);

        // Send initial phrase to streaming TTS
        try {
          if (streamingSession && streamingSession.isActive()) {
            streamingSession.addText(transcript);
          } else {
            console.log(
              `⚠️  Streaming session not active, falling back to legacy TTS`
            );
            await processIncrementalContent(transcript, false);
          }
        } catch (error) {
          console.error(
            `❌ Error sending to streaming TTS, falling back to legacy:`,
            error.message
          );
          await processIncrementalContent(transcript, false);
        }
      } else {
        console.log(`⏳ Streaming: Waiting for more words: ${words.length}/1 - "${transcript}"`);
      }
      return;
    }

    // Phase 2: Extract and stream only new content
    const newContent = extractNewContentAdvanced(
      transcript,
      previousInterimText
    );

    if (newContent && newContent.trim()) {
      console.log(`📊 STREAMING PREVIOUS: "${previousInterimText}"`);
      console.log(`📊 STREAMING CURRENT:  "${transcript}"`);
      console.log(`✨ STREAMING NEW CONTENT: "${newContent}"`);

      // Update previous for next comparison
      previousInterimText = transcript;

      // Send new content to streaming TTS immediately
      try {
        if (streamingSession && streamingSession.isActive()) {
          streamingSession.addText(newContent);
        } else {
          console.log(
            `⚠️  Streaming session not active, falling back to legacy TTS`
          );
          await processIncrementalContent(newContent, false);
        }
      } catch (error) {
        console.error(
          `❌ Error sending to streaming TTS, falling back to legacy:`,
          error.message
        );
        await processIncrementalContent(newContent, false);
      }
    } else {
      console.log(
        `🔄 Streaming: No new content detected. Current: "${transcript}", Previous: "${previousInterimText}"`
      );
      previousInterimText = transcript; // Ensure previousInterimText is updated even if no new content.
    }
  }

  ws.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);

      // Debug: Log all incoming messages
      if (msg.event !== "media") {
        console.log(
          `📨 Received: ${msg.event}`,
          msg.event === "start" ? `CallSid: ${msg.start?.callSid}` : ""
        );
      }

      switch (msg.event) {
        case "start":
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`🎙️  Stream started: ${callSid}`);

          activeConnections.set(callSid, { ws, streamSid });

          // Create initial recognition stream
          createRecognitionStream();

          // Initialize streaming TTS session if enabled
          if (streamingAccentConverter) {
            try {
              streamingSession = streamingAccentConverter.createSession(
                callSid,
                streamSid,
                ws
              );
              console.log(`🎵 Streaming TTS session created for ${callSid}`);

              // Setup fallback mechanism for streaming failures
              streamingSession.fallbackToLegacy = false;
            } catch (error) {
              console.error(
                `❌ Error creating streaming TTS session for ${callSid}:`,
                error.message
              );
              console.log(`🔄 Falling back to legacy TTS for ${callSid}`);
              streamingSession = null;
            }
          }

          break;

        case "media":
          if (
            recognizeStream &&
            !streamDestroyed &&
            msg.media &&
            msg.media.payload
          ) {
            const audioData = Buffer.from(msg.media.payload, "base64");

            if (!firstAudioChunkSentToStt) {
              // For the very first audio chunk, send it immediately to STT
              console.log("🚀 Sending first audio chunk immediately to STT to reduce initial latency.");
              try {
                if (recognizeStream && !streamDestroyed && recognizeStream.writable) {
                  recognizeStream.write(audioData);
                  firstAudioChunkSentToStt = true; // Set the flag after sending
                } else {
                  console.log('⚠️ STT stream not writable for the first chunk. Buffering it.');
                  // If stream isn't ready, buffer it to be sent with the next batch logic
                  audioChunks.push(audioData);
                }
              } catch (error) {
                console.error('❌ Error writing first audio chunk to STT stream:', error.message);
                streamDestroyed = true; // Mark stream as needing recreation
                createRecognitionStream(); // Attempt to recreate
                audioChunks.push(audioData); // Buffer it as a fallback
              }
            } else {
              // For subsequent audio chunks, use batching logic
              audioChunks.push(audioData);
              // Reduced batch size from 10 to 5 (approx 100ms instead of 200ms) for general responsiveness
              if (audioChunks.length >= 5) {
                const combinedAudio = Buffer.concat(audioChunks);
                audioChunks = []; // Clear chunks after combining

                try {
                  if (recognizeStream && !streamDestroyed && recognizeStream.writable) {
                    recognizeStream.write(combinedAudio);
                    lastAudioSentTime = Date.now(); // Update timestamp after successful write
                  } else {
                    console.log('⚠️ STT stream not writable for batched audio. Re-queuing batch.');
                    audioChunks.unshift(...Buffer.isBuffer(combinedAudio) ? [combinedAudio] : combinedAudio); // Prepend batch to be retried
                  }
                } catch (error) {
                  console.error('❌ Error writing batched audio to STT stream:', error.message);
                  audioChunks.unshift(...Buffer.isBuffer(combinedAudio) ? [combinedAudio] : combinedAudio); // Prepend batch to be retried
                  streamDestroyed = true;
                  createRecognitionStream();
                }
              }
            }
          }
          break;

        case "stop":
          console.log(`🛑 Stream stopped: ${callSid}`);
          streamDestroyed = true;
          if (recognizeStream) {
            try {
              recognizeStream.end();
            } catch (error) {
              console.log("Error ending stream on stop:", error.message);
            }
          }

          // Close streaming TTS session
          if (streamingSession) {
            try {
              streamingSession.close();
              console.log(`🔚 Streaming TTS session closed for ${callSid}`);
            } catch (error) {
              console.error(
                `❌ Error closing streaming TTS session for ${callSid}:`,
                error.message
              );
            }
            streamingSession = null;
          }

          activeConnections.delete(callSid);
          break;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    console.log(`WebSocket closed: ${callSid}`);
    streamDestroyed = true;

    if (recognizeStream) {
      try {
        recognizeStream.end();
      } catch (error) {
        console.log("Error ending stream on close:", error.message);
      }
    }

    // Close streaming TTS session
    if (streamingSession) {
      try {
        streamingSession.close();
        console.log(
          `🔚 Streaming TTS session closed on WebSocket close for ${callSid}`
        );
      } catch (error) {
        console.error(
          `❌ Error closing streaming TTS session on WebSocket close for ${callSid}:`,
          error.message
        );
      }
      streamingSession = null;
    }

    if (callSid) {
      activeConnections.delete(callSid);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    streamDestroyed = true;

    // Close streaming TTS session on error
    if (streamingSession) {
      try {
        streamingSession.close();
        console.log(
          `🔚 Streaming TTS session closed on WebSocket error for ${callSid}`
        );
      } catch (error) {
        console.error(
          `❌ Error closing streaming TTS session on WebSocket error for ${callSid}:`,
          error.message
        );
      }
      streamingSession = null;
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
          console.log(
            `✅ Different content: ${(similarity * 100).toFixed(1)}% similar`
          );
          return true;
        } else {
          console.log(
            `🔄 Too similar: ${(similarity * 100).toFixed(1)}% similar`
          );
          return false;
        }
      }
      return true;
    } else {
      // For interim results, be selective but not too restrictive
      if (timeSinceLastAudio < 1500) {
        // 1.5 seconds minimum for interim
        console.log(`⏰ Too soon: ${timeSinceLastAudio}ms since last audio`);
        return false;
      }

      // Check for natural speech patterns
      const hasNaturalBreak =
        /[.!?]$/.test(text.trim()) ||
        /\b(and|but|so|because|however|also|now|then|actually)\b/i.test(text);

      if (!hasNaturalBreak && text.split(" ").length < 8) {
        console.log(`🔄 No natural break in short phrase`);
        return false;
      }

      // Check similarity with recent history
      const recentItems = conversationHistory.slice(-2); // Last 2 items
      for (const item of recentItems) {
        const similarity = calculateSimilarity(cleanText, item.cleanText);
        if (similarity > 0.75) {
          // 75% threshold for interim
          console.log(
            `🔄 Similar to recent: ${(similarity * 100).toFixed(1)}%`
          );
          return false;
        }
      }

      return true;
    }
  }

  // Process natural conversation
  async function processNaturalConversation(text, isFinal) {
    const cleanText = cleanForComparison(text);

    // Add to conversation history
    conversationHistory.push({
      originalText: text,
      cleanText: cleanText,
      timestamp: Date.now(),
      isFinal: isFinal,
    });

    // Keep only recent history (last 3 items for efficiency)
    if (conversationHistory.length > 3) {
      conversationHistory = conversationHistory.slice(-3);
    }

    // Update tracking
    lastConvertedText = text;
    lastConversionTime = Date.now();

    const startTime = Date.now();
    console.log(
      `⏱️  Converting ${isFinal ? "FINAL" : "INTERIM"} at: ${startTime}`
    );
    console.log(`📊 History: ${conversationHistory.length} items`);

    try {
      await convertAndSendAudio(text, ws, streamSid, startTime, isFinal);
      lastAudioSentTime = Date.now();
    } catch (error) {
      console.error("Conversion error:", error.message);
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

  // Handle incremental interim processing
  async function handleIncrementalInterim(transcript) {
    const words = transcript.trim().split(" ");

    // Phase 1: Wait for initial 3-4 words (reduced from 4-5 for faster response)
    if (!isInitialPhaseComplete) {
      // wordBuffer = words; // wordBuffer seems unused for gating logic now
      
      if (words.length >= 1) { // Changed from 3 to 1 for faster initial response
        isInitialPhaseComplete = true;
        previousInterimText = transcript;
        
        console.log(`🚀 LEGACY INITIAL PHASE COMPLETE: "${transcript}" (${words.length} word(s))`);
        console.log(`📝 Starting incremental streaming...`);
        
        // Convert the initial phrase
        await processIncrementalContent(transcript, false);
      } else {
        console.log(`⏳ Legacy: Waiting for more words: ${words.length}/1 - "${transcript}"`);
      }
      return;
    }

    // Phase 2: Use advanced extraction for new content
    const newContent = extractNewContentAdvanced(
      transcript,
      previousInterimText
    );

    if (newContent && newContent.trim()) {
      console.log(`📊 LEGACY PREVIOUS: "${previousInterimText}"`);
      console.log(`📊 LEGACY CURRENT:  "${transcript}"`);
      console.log(`✨ LEGACY NEW CONTENT: "${newContent}"`);

      // Update previous for next comparison
      previousInterimText = transcript;

      // Stream the new content immediately (no restrictions)
      await processIncrementalContent(newContent, false);
    } else {
      console.log(`🔄 Legacy: No new content detected`);
    }
  }

  // Extract new content by comparing current with previous (advanced version)
  function extractNewContentAdvanced(currentText, previousText) {
    console.log(`[extractNewContentAdvanced INPUTS] Current: "${currentText}", Previous: "${previousText}"`);
    if (!previousText || previousText.trim() === "") {
      console.log(`[extractNewContentAdvanced OUTPUT] New Content (no previous): "${currentText}"`);
      return currentText;
    }

    const currentOriginalWords = currentText.trim().split(/\s+/);
    const previousOriginalWords = previousText.trim().split(/\s+/);

    let commonPrefixLength = 0;
    const minLength = Math.min(
      currentOriginalWords.length,
      previousOriginalWords.length
    );

    for (let i = 0; i < minLength; i++) {
      // Use a more explicit regex for cleaning words for comparison
      const cleanCurrentWord = currentOriginalWords[i]
        .toLowerCase()
        .replace(/[^a-zA-Z0-9'-]/g, "");
      const cleanPreviousWord = previousOriginalWords[i]
        .toLowerCase()
        .replace(/[^a-zA-Z0-9'-]/g, "");

      // Log the first pair of cleaned words for critical debugging
      if (i === 0) {
        console.log(
          `[extractNewContentAdvanced DEBUG] First words comparison: prevClean='${cleanPreviousWord}' (from '${
            previousOriginalWords[0]
          }'), currClean='${cleanCurrentWord}' (from '${
            currentOriginalWords[0]
          }'), match=${cleanPreviousWord === cleanCurrentWord}`
        );
      }

      if (cleanCurrentWord === cleanPreviousWord && cleanCurrentWord !== "") {
        commonPrefixLength = i + 1;
      } else {
        break;
      }
    }

    // Extract new words from after the common prefix, using original words from currentText
    const newWords = currentOriginalWords.slice(commonPrefixLength);

    if (newWords.length > 0) {
      const newContent = newWords.join(" ");
      console.log(`🔍 Advanced diff: commonPrefix=${commonPrefixLength} (based on cleaned words), newWords=${newWords.length}, content="${newContent}"`);
      console.log(`[extractNewContentAdvanced OUTPUT] New Content: "${newContent}"`);
      return newContent;
    }

    // Check if current text is shorter (word was removed/corrected) - using original word counts
    if (currentOriginalWords.length < previousOriginalWords.length) {
      console.log(`🔄 Advanced diff: Text shortened (original word count), no new content added from suffix.`);
      console.log(`[extractNewContentAdvanced OUTPUT] New Content (text shortened): ""`);
      return "";
    }

    // Check for word corrections or changes if lengths are equal but prefix didn't cover everything
    if (
      currentOriginalWords.length === previousOriginalWords.length &&
      commonPrefixLength < currentOriginalWords.length
    ) {
      // This means a difference occurred at index commonPrefixLength
      const correctedContent = currentOriginalWords
        .slice(commonPrefixLength)
        .join(" ");
      console.log(
        `🔧 Advanced diff: Word correction/change detected after prefix at original index ${commonPrefixLength}, content="${correctedContent}"`
      );
      console.log(`[extractNewContentAdvanced OUTPUT] New Content (correction): "${correctedContent}"`);
      return correctedContent;
    }

    console.log(
      `🔄 Advanced diff: No meaningful changes detected. commonPrefix=${commonPrefixLength}, currentLen=${currentOriginalWords.length}, prevLen=${previousOriginalWords.length}`
    );
    console.log(`[extractNewContentAdvanced OUTPUT] New Content (no meaningful change): ""`);
    return "";
  }

  // Process incremental content
  async function processIncrementalContent(content, isFinal) {
    if (!content || !content.trim()) {
      console.log(`⚠️  Empty content, skipping`);
      return;
    }

    // During streaming phase, convert everything immediately
    // Only skip during initial phase (which is handled separately)

    // Update tracking
    lastConvertedText = content;
    lastConversionTime = Date.now();

    const startTime = Date.now();
    console.log(`⏱️  Converting ${isFinal ? "FINAL" : "STREAM"}: "${content}"`);

    try {
      await convertAndSendAudio(content, ws, streamSid, startTime, isFinal);
      lastAudioSentTime = Date.now();
    } catch (error) {
      console.error("Conversion error:", error.message);
    }
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
    console.log(`🎯 Converting ${isFinal ? "FINAL" : "STREAM"}: "${text}"`);
    console.log(
      `🔍 WebSocket state: ${ws.readyState === ws.OPEN ? "OPEN" : "CLOSED"}`
    );

    // Check if WebSocket is still open
    if (ws.readyState !== ws.OPEN) {
      console.log("❌ WebSocket not open, skipping audio send");
      return;
    }

    // Check if TTS result is cached
    if (ttsCache.has(text)) {
      if (currentConversionId !== ws.conversionState.current) {
        console.log("⚠️ Outdated cached TTS conversion request, skipping sending audio");
        return;
      }
      console.log("✅ Cache hit for TTS conversion");
      const cachedAudioContent = ttsCache.get(text);
      const audioBase64 = cachedAudioContent.toString("base64");
      const mediaMessage = {
        event: "media",
        streamSid: streamSid,
        media: {
          payload: audioBase64,
        },
      };
      console.log("📤 Sending cached audio via WebSocket...");
      ws.send(JSON.stringify(mediaMessage));
      const totalLatency = Date.now() - startTime;
      console.log(`✅ Audio sent for: "${text}"`);
      console.log(`⏱️  TIMING: Total=${totalLatency}ms (using cache)`);
      return;
    }

    console.log(`📞 Calling Google TTS...`);

    // Convert to British English speech with optimized settings
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: {
        languageCode: "en-GB",
        name: "en-GB-Neural2-B",
        ssmlGender: "MALE",
      },
      audioConfig: {
        audioEncoding: "MULAW",
        sampleRateHertz: 8000,
        speakingRate: 1.0, // Normal speed for natural conversation
        pitch: 0.0,
        volumeGainDb: 2.0, // Slightly louder for clarity
      },
    });
    const ttsEndTime = Date.now();
    const ttsLatency = ttsEndTime - conversionStartTime;

    if (response.audioContent && ws.readyState === ws.OPEN) {
      if (currentConversionId !== ws.conversionState.current) {
        console.log("⚠️ Outdated TTS conversion result, skipping sending audio");
        return;
      }
      // Cache the TTS result for future requests
      ttsCache.set(text, response.audioContent);
      console.log(
        `📊 Audio generated in ${ttsLatency}ms, size: ${response.audioContent.length} bytes`
      );

      // Send the audio as one message for smooth playback
      const audioBase64 = response.audioContent.toString("base64");

      const mediaMessage = {
        event: "media",
        streamSid: streamSid,
        media: {
          payload: audioBase64,
        },
      };

      console.log(`📤 Sending audio via WebSocket...`);

      try {
        ws.send(JSON.stringify(mediaMessage));
        const totalLatency = Date.now() - startTime;
        const sendLatency = Date.now() - ttsEndTime;

        console.log(`✅ Audio sent for: "${text}"`);
        console.log(
          `⏱️  TIMING: Total=${totalLatency}ms | TTS=${ttsLatency}ms | Send=${sendLatency}ms`
        );
        console.log(
          `📈 Speed: ${((text.length / totalLatency) * 1000).toFixed(
            1
          )} chars/sec`
        );
        console.log("🎵 Real-time streaming active");
        console.log("─".repeat(50));
      } catch (wsError) {
        console.error("❌ Error sending WebSocket message:", wsError.message);
      }
    } else {
      console.log(`❌ No audio content or WebSocket closed`);
    }
  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error(
      `❌ Error after ${errorTime}ms converting audio:`,
      error.message
    );
  }
}
