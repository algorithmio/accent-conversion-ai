# Streaming TTS Fixes - Issue Resolution

## Issues Addressed

### 1. **Stream Timeout Error (5-second abort)**
**Problem**: Google Cloud StreamingSynthesize API requires continuous input every 5 seconds, but the system experienced periods of silence longer than that, causing stream aborts.

**Error Message**: 
```
Stream aborted due to long duration elapsed without input sent. Input must be sent continuously, at least every 5s seconds.
```

### 2. **Configuration Duplication**
**Problem**: Voice and audio configuration was duplicated across multiple services, leading to inconsistency and maintenance issues.

## Solutions Implemented

### 1. **Keepalive Mechanism**
- **File**: `src/services/StreamingTTSService.js`
- **Implementation**: Added automatic keepalive mechanism that sends minimal text input every 4 seconds when no real text is being processed
- **Features**:
  - Monitors time since last text input
  - Sends single space character as keepalive
  - Only activates during periods of silence (>3 seconds)
  - Prevents the 5-second timeout

### 2. **Automatic Reconnection**
- **File**: `src/services/StreamingTTSService.js`
- **Implementation**: Added intelligent reconnection logic for recoverable errors
- **Features**:
  - Detects recoverable errors (ABORTED, DEADLINE_EXCEEDED)
  - Attempts up to 3 reconnections with exponential backoff
  - Recreates streaming session automatically
  - Maintains session state during reconnection

### 3. **Graceful Error Handling**
- **Files**: `src/services/StreamingTTSService.js`, `src/services/StreamingAccentConverterV2.js`, `server.js`
- **Implementation**: Added comprehensive error handling with fallback mechanisms
- **Features**:
  - Prevents unhandled error crashes
  - Falls back to legacy TTS when streaming fails
  - Proper session cleanup on errors
  - Error event emission for monitoring

### 4. **Centralized Configuration**
- **File**: `src/config/tts-config.js` (new)
- **Implementation**: Created centralized configuration management
- **Features**:
  - Single source of truth for voice settings
  - Eliminates configuration duplication
  - Easy voice switching and customization
  - Configurable timing parameters

### 5. **Configuration Deduplication**
- **Files**: `src/services/StreamingTTSService.js`, `src/services/StreamingAccentConverterV2.js`
- **Implementation**: Removed duplicate voice configurations
- **Changes**:
  - StreamingTTSService uses centralized config as default
  - StreamingAccentConverterV2 only overrides audio settings
  - Eliminated hardcoded voice settings

## Configuration Structure

### Centralized TTS Config (`src/config/tts-config.js`)
```javascript
const TTS_CONFIG = {
  voice: {
    languageCode: 'en-GB',
    name: 'en-GB-Chirp3-HD-Fenrir',
    ssmlGender: 'MALE'
  },
  streamingAudioConfig: {
    audioEncoding: 'MULAW',
    sampleRateHertz: 8000,
    speakingRate: 1.0,
    pitch: 0.0,
    volumeGainDb: 2.0
  },
  streaming: {
    keepaliveIntervalMs: 4000,
    maxReconnectAttempts: 3,
    reconnectBackoffMs: 1000,
    maxInactiveTimeMs: 5 * 60 * 1000,
    textOptimization: true
  }
};
```

## Key Improvements

### 1. **Reliability**
- ✅ Eliminates 5-second timeout errors
- ✅ Automatic recovery from stream failures
- ✅ Graceful fallback to legacy TTS
- ✅ Proper session lifecycle management

### 2. **Maintainability**
- ✅ Single configuration source
- ✅ No duplicate voice settings
- ✅ Easy voice switching
- ✅ Configurable timing parameters

### 3. **Monitoring**
- ✅ Comprehensive logging
- ✅ Session metrics tracking
- ✅ Error event emission
- ✅ Reconnection attempt tracking

### 4. **Performance**
- ✅ Optimized keepalive timing
- ✅ Exponential backoff for reconnections
- ✅ Efficient session cleanup
- ✅ Minimal overhead keepalive messages

## Testing Recommendations

1. **Long Conversation Test**: Test with extended periods of silence (>5 seconds)
2. **Network Interruption Test**: Simulate network issues to test reconnection
3. **High Load Test**: Test multiple concurrent sessions
4. **Voice Configuration Test**: Verify centralized config works correctly
5. **Fallback Test**: Ensure legacy TTS fallback works when streaming fails

## Monitoring Points

- Watch for keepalive messages in logs (`💓 StreamingTTS: Sending keepalive`)
- Monitor reconnection attempts (`🔄 StreamingTTS: Attempting to reconnect`)
- Check session metrics for performance tracking
- Verify fallback activation when needed (`⚠️ Streaming session unavailable, falling back to legacy TTS`)

## Future Enhancements

1. **Dynamic Voice Switching**: Allow runtime voice changes
2. **Advanced Keepalive**: Smarter keepalive based on conversation patterns
3. **Health Monitoring**: Add health check endpoints
4. **Performance Metrics**: Detailed latency and throughput tracking 