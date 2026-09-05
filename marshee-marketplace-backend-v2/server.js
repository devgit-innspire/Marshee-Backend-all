const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const specs = require('./config/swagger');
const connectDB = require('./config/db.config');
const productRoutes = require('./routes/product.routes');
const authRoutes = require('./routes/auth.routes');
const categoryRoutes = require('./routes/category.routes');
const brandRoutes = require('./routes/brand.routes');
const partnerRoutes = require('./routes/partner.routes');
const couponRoutes = require('./routes/coupon.routes');
const cartRoutes = require('./routes/cart.routes');
const wishlistRoutes = require('./routes/wishlist.routes');
const orderRoutes = require('./routes/order.routes');
const petRoutes = require('./routes/pet.routes');
const paymentRoutes = require('./routes/payment.routes');
const serviceRoutes = require('./routes/service.routes');
const cookieParser = require('cookie-parser');
const addressRoutes = require('./routes/address.routes');
const surveyRoutes = require('./routes/survey.routes');
const preOrderRoutes = require('./routes/preOrderForm.routes');
const wogglePreOrderRoutes = require('./routes/wogglePreOrder.routes');
const shiprocketRoutes = require('./routes/shiprocket.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const uploadRoutes = require('./routes/upload.routes');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB (non-blocking - don't wait for connection to start server)
// Cloud Run requires the server to start listening quickly
connectDB().catch(err => {
    console.error('MongoDB connection error (server will continue):', err.message);
    // Don't exit - let the server start even if DB connection fails
    // The connection will retry automatically
});

// Middleware
app.use(cookieParser());
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(morgan('dev')); // Request logging
const defaultOrigins = [
    'https://marshee-admin-dashboard.vercel.app',
    'https://www.marshee.com',
    'https://marshee.com',
    'http://localhost:3000',
    'http://localhost:3001'
];

let allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : [];

// Merge default origins
allowedOrigins = [...new Set([...allowedOrigins, ...defaultOrigins])];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, or postman)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        return callback(null, false); // Reject by not adding Access-Control-Allow-Origin
    },
    credentials: true,
}));

// Webhook middleware: Preserve raw body for signature verification
// Must be applied BEFORE express.json() to preserve exact body bytes
const { preserveRawBody, conditionalJsonParser } = require('./middleware/webhook');
app.use(preserveRawBody);

// Conditional JSON parsing: Skip for webhooks, apply for other routes
app.use(conditionalJsonParser);
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Swagger Documentation — dev/staging only, never exposed in production
if (process.env.NODE_ENV !== 'production') {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
}

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/brands', brandRoutes);
app.use('/api/v1/partners', partnerRoutes);
app.use('/api/v1/coupons', couponRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/pets', petRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/survey', surveyRoutes);
app.use('/api/v1/preOrder', preOrderRoutes);
app.use('/api/v1/woggle', wogglePreOrderRoutes);
app.use('/api/v1/shiprocket', shiprocketRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/upload', uploadRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Server is healthy',
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Handle 404 routes
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Start server
// Cloud Run requires the server to listen on the PORT environment variable
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
});

// Handle server errors
server.on('error', (err) => {
    console.error('Server error:', err);
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
    // Close server & exit process
    process.exit(1);
});

module.exports = app; // For testing purposes
