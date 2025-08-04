// server.js - Main server file
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import configurations and utilities
const { testConnection, initDatabase } = require('./config/database');
const { ensureUploadDir } = require('./utils/fileUpload');

// Import routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
// const corsOptions = {
//     origin: function (origin, callback) {
//         // Allow requests with no origin (mobile apps, Postman, etc.)
//         if (!origin) return callback(null, true);
        
//         const allowedOrigins = process.env.ALLOWED_ORIGINS 
//             ? process.env.ALLOWED_ORIGINS.split(',')
//             : ['http://localhost:3000', 'http://localhost:3001'];
        
//         if (allowedOrigins.includes(origin)) {
//             callback(null, true);
//         } else {
//             callback(new Error('Not allowed by CORS'));
//         }
//     },
//     credentials: true,
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
// };

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
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);

// Welcome endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to Profile Management API',
        version: '1.0.0',
        endpoints: {
            auth: {
                registration: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                logout: 'POST /api/auth/logout',
                profile: 'GET /api/auth/profile',
                updateProfile: 'PUT /api/auth/profile',
                changePassword: 'PUT /api/auth/change-password'
            },
            profiles: {
                create: 'POST /api/profiles',
                getAll: 'GET /api/profiles',
                getById: 'GET /api/profiles/:id',
                update: 'PUT /api/profiles/:id',
                delete: 'DELETE /api/profiles/:id',
                stats: 'GET /api/profiles/stats (Admin only)'
            }
        },
        documentation: 'See README.md for detailed API documentation'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error);

    // Handle CORS errors
    if (error.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS policy violation'
        });
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({
            success: false,
            message: 'Invalid JSON in request body'
        });
    }

    // Default error response
    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
});

// Handle 404 routes
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.originalUrl} not found`
    });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    process.exit(0);
});

// Start server
const startServer = async () => {
    try {
        console.log('🚀 Starting Profile Management API...');
        
        // Test database connection
        console.log('📡 Testing database connection...');
        const dbConnected = await testConnection();
        
        if (!dbConnected) {
            console.error('❌ Failed to connect to database. Please check your configuration.');
            process.exit(1);
        }

        // Initialize database tables
        console.log('📊 Initializing database tables...');
        await initDatabase();

        // Ensure upload directory exists
        console.log('📁 Setting up upload directory...');
        await ensureUploadDir();

        // Start the server
        app.listen(PORT, () => {
            console.log(`✅ Server is running on port ${PORT}`);
            console.log(`🌐 API URL: http://localhost:${PORT}`);
            console.log(`📚 API Documentation: http://localhost:${PORT}/`);
            console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
            console.log(`📁 File Uploads: ${process.env.UPLOAD_DIR || './uploads'}`);
            console.log('📊 Database: Connected and initialized');
            console.log('\n🎉 Server started successfully!\n');
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
};

// Initialize the server
startServer();