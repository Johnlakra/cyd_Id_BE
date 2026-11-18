// server.js - Main server file
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { ensureUploadDir } = require('./utils/fileUpload');
const { corsOptions, jsonErrorHandler } = require('./middleware/security');

// Import routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const profileHolderRoutes = require('./routes/profileHolder');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render/Vercel's proxy: use the client IP from X-Forwarded-For (one hop) so rate limits
// apply per client rather than to the proxy as a whole.
app.set('trust proxy', 1);

// Middleware
// crossOriginResourcePolicy is relaxed so the frontend (another origin) can still load /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions()));
app.use(express.json({ limit: '10mb' })); // Increased limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files (uploaded images)
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads')));

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} - ${req.method} ${req.path} - ${req.ip}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// API Routes
app.use('/auth', authRoutes);
app.use('/profiles', profileRoutes);
app.use('/profile-holder', profileHolderRoutes);

// Handle 404 routes
// app.use('*', (req, res) => {
//     res.status(404).json({
//         success: false,
//         message: `Route ${req.method} ${req.originalUrl} not found`
//     });
// });

// Graceful shutdown handling
// process.on('SIGTERM', () => {
//     console.log('SIGTERM received. Shutting down gracefully...');
//     process.exit(0);
// });

// process.on('SIGINT', () => {
//     console.log('SIGINT received. Shutting down gracefully...');
//     process.exit(0);
// });

// Must be registered after all routes: turns body-parser errors and anything unhandled into a
// JSON response instead of Express's HTML stack-trace page.
app.use(jsonErrorHandler);

// Start server
app.listen(PORT, () => {
            console.log(`✅ Server is running on port ${PORT}`);
            console.log('\n🎉 Server started successfully!\n');
        })
// const startServer = async () => {
//     try {
//         console.log('🚀 Starting Profile Management API...');
        
//         // Test database connection
//         console.log('📡 Testing database connection...');
//         const dbConnected = await testConnection();
        
//         if (!dbConnected) {
//             console.error('❌ Failed to connect to database. Please check your configuration.');
//             process.exit(1);
//         }

//         // Initialize database tables
//         console.log('📊 Initializing database tables...');
//         await initDatabase();

//         // Ensure upload directory exists
//         console.log('📁 Setting up upload directory...');
//         await ensureUploadDir();

//         // Start the server
//         ;

//     } catch (error) {
//         console.error('❌ Failed to start server:', error.message);
//         process.exit(1);
//     }
// };

// // Initialize the server
// startServer();