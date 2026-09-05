require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const { connectToExistingDB } = require('./utils/databaseConnection');

// Import routes
const petFitnessRoutes = require('./routes/petFitness.routes');
const petFitnessSessionRoutes = require('./routes/petFitnessSession.routes');
const petDeviceRoutes = require('./routes/petDevice.routes');
const userRoutes = require('./routes/user.routes');

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Connect to existing database
connectToExistingDB();

// Security middleware - configure helmet for API
app.use(helmet({
    contentSecurityPolicy: false, // APIs typically don't need CSP
    crossOriginEmbedderPolicy: false
}));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS: permissive by default; supports optional allowlist via env
const parseOrigins = (value) => {
    if (!value) return null;
    return value.split(',').map(s => s.trim()).filter(Boolean);
};

const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
const corsOptions = {
    origin: allowedOrigins ? (origin, cb) => {
        // Allow no-origin requests (mobile apps, curl) and allowlisted origins
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
    } : true, // allow all when no env configured
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],
    exposedHeaders: [],
    credentials: false,
    maxAge: 86400
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/v1/pet-fitness', petFitnessRoutes);
app.use('/api/v1/pet-fitness-sessions', petFitnessSessionRoutes);
app.use('/api/v1/pets', petDeviceRoutes);
app.use('/api/v1/users', userRoutes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Extended Pet Backend is healthy',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// API Info endpoint
app.get('/api', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Extended Pet Management API',
        version: '1.0.0',
        endpoints: {
            users: '/api/v1/users',
            petFitness: '/api/v1/pet-fitness',
            petFitnessSessions: '/api/v1/pet-fitness-sessions',
            petDevices: '/api/v1/pets'
        },
        documentation: 'This API extends your existing pet management system with fitness band data tracking including activity metrics, sensor data, and health monitoring.'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    const isDevelopment = NODE_ENV === 'development';
    
    // Log error details
    console.error(`[${new Date().toISOString()}] Error:`, {
        message: err.message,
        stack: isDevelopment ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(isDevelopment && { stack: err.stack })
    });
});

// Handle 404 routes
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        availableRoutes: {
            health: 'GET /health',
            apiInfo: 'GET /api',
            petFitness: [
                'GET /api/v1/pet-fitness',
                'POST /api/v1/pet-fitness',
                'PUT /api/v1/pet-fitness/:fitnessId',
                'DELETE /api/v1/pet-fitness/:fitnessId',
                'GET /api/v1/pet-fitness/pet/:petId',
                'GET /api/v1/pet-fitness/pet/:petId/latest',
                'GET /api/v1/pet-fitness/pet/:petId/stats'
            ],
            petFitnessSessions: [
                'POST /api/v1/pet-fitness-sessions',
                'POST /api/v1/pet-fitness-sessions/json',
                'GET /api/v1/pet-fitness-sessions/:sessionId',
                'DELETE /api/v1/pet-fitness-sessions/:sessionId',
                'GET /api/v1/pet-fitness-sessions/pet/:petId',
                'GET /api/v1/pet-fitness-sessions/pet/:petId/latest',
                'GET /api/v1/pet-fitness-sessions/pet/:petId/stats'
            ],
            petDevices: [
                'POST /api/v1/pets/:petId/devices',
                'GET /api/v1/pets/:petId/devices',
                'GET /api/v1/pets/:petId/devices/:deviceId',
                'PUT /api/v1/pets/:petId/devices/:deviceId',
                'DELETE /api/v1/pets/:petId/devices/:deviceId'
            ]
        }
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Pet Fitness Backend running on port ${PORT}`);
    console.log(`🌍 Environment: ${NODE_ENV}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API info: http://localhost:${PORT}/api`);
    console.log(`🏃‍♂️ Fitness tracking: http://localhost:${PORT}/api/v1/pet-fitness`);
    console.log(`📊 Session tracking: http://localhost:${PORT}/api/v1/pet-fitness-sessions`);
    console.log(`🔧 Device management: http://localhost:${PORT}/api/v1/pets`);
    console.log(`🔗 Connected to existing pets_ecommerce database`);
});

// Set server timeout (30 seconds)
server.timeout = 30000;

// Graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED REJECTION]', err);
    if (NODE_ENV === 'production') {
        // In production, don't exit on unhandled rejections
        // Log and continue
    } else {
        process.exit(1);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
    process.exit(1);
});

module.exports = app;
