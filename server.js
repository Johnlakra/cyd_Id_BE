// server.js - Main server file
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { ensureUploadDir } = require('./utils/fileUpload');

// Import routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const profileHolderRoutes = require('./routes/profileHolder');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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