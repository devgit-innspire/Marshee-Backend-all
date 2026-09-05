const mongoose = require('mongoose');

const maskUri = (uri) => uri.replace(/:\/\/[^@]+@/, '://<credentials>@');

const connectWithUri = async (uri) => {
    // Configure mongoose options globally; remove deprecated flags
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(uri, {
        autoIndex: true
    });

    // Ensure model indexes are synchronized (drops old unique(email) if present)
    try {
        const User = require('../models/user.model');
        await User.syncIndexes();
        console.log('User indexes synced');
    } catch (e) {
        console.error('Failed syncing User indexes:', e && e.message ? e.message : e);
    }

    return conn;
};

const connectDB = async () => {
    const primaryUri = process.env.MONGODB_URI;
    const secondaryUri = process.env.MONGODB_URI_SECONDARY || process.env.MONGODB_URI_ALT;

    const candidates = [primaryUri, secondaryUri].filter(Boolean);

    if (candidates.length === 0) {
        throw new Error('No MongoDB URI configured. Set MONGODB_URI (and optionally MONGODB_URI_SECONDARY) before starting the server.');
    }

    for (const uri of candidates) {
        try {
            const connection = await connectWithUri(uri);
            console.log(`MongoDB Connected: ${connection.connection.host}`);
            return;
        } catch (error) {
            const msg = (error && error.message) ? error.message : String(error);
            console.error(`MongoDB connection attempt failed for ${maskUri(uri)}. Reason: ${msg}`);

            const isDnsError = /ENOTFOUND|queryTxt\s+EREFUSED|ECONNREFUSED|getaddrinfo/i.test(msg);
            // Continue to next candidate on DNS/connection issues
            if (!isDnsError) {
                // For non-network errors (e.g., auth), only try next if available
                continue;
            }
        }
    }

    console.error('All MongoDB connection attempts failed. Please verify your MONGODB_URI or start local MongoDB.');
    // Don't exit in Cloud Run - let the server start and retry connection
    // Only exit in local development
    if (process.env.NODE_ENV !== 'production' && !process.env.K_SERVICE) {
        console.error('Exiting due to MongoDB connection failure (local development)');
        process.exit(1);
    } else {
        console.warn('Server will continue without MongoDB connection. Connection will retry automatically.');
    }
};

// Handling MongoDB connection events
mongoose.connection.on('connected', () => {
    console.log('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.error(`Mongoose connection error: ${err}`);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected from MongoDB');
});

// Handle application termination
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('MongoDB connection closed through app termination');
    process.exit(0);
});

module.exports = connectDB;
