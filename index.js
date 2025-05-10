require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const accentRoutes = require('./src/routes/accentRoutes');
const streamingController = require('./src/controllers/StreamingController');

// Log API key configuration (without showing the actual key)
console.log('API Key configuration:');
console.log('- GOOGLE_API_KEY set:', process.env.GOOGLE_API_KEY ? 'Yes' : 'No');
console.log('- GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || 'Not set (good)');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server and socket.io instance
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: "*"
  },
  maxHttpBufferSize: 1e8 // 100 MB max buffer size for audio data
});

// Initialize socket handlers
streamingController.initializeSocketHandlers(io);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/accent', accentRoutes);

// Simple home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Something went wrong on the server',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Accent Conversion API server running on port ${PORT}`);
  console.log(`Using API key authentication only (Application Default Credentials disabled)`);
}); 