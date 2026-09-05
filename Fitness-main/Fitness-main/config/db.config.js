const mongoose = require('mongoose');

const DEFAULT_LOCAL_URI = 'mongodb://127.0.0.1:27017/pets_ecommerce';

const connectWithUri = async (uri) => {
    // Configure mongoose options globally; remove deprecated flags
    mongoose.set('strictQuery', true);
    return mongoose.connect(uri, {
        autoIndex: true
    });
};

const connectDB = async () => {
    const primaryUri = process.env.MONGODB_URI;
    const secondaryUri = process.env.MONGODB_URI_SECONDARY || process.env.MONGODB_URI_ALT;
    const localFallbackUri = DEFAULT_LOCAL_URI;

    const candidates = [primaryUri, secondaryUri, localFallbackUri].filter(Boolean);

    for (const uri of candidates) {
        try {
            const connection = await connectWithUri(uri);
            console.log(`Extended Backend - MongoDB Connected: ${connection.connection.host}`);
            return;
        } catch (error) {
            const msg = (error && error.message) ? error.message : String(error);
            console.error(`Extended Backend - MongoDB connection attempt failed for URI: ${uri}. Reason: ${msg}`);

            const isDnsError = /ENOTFOUND|queryTxt\s+EREFUSED|ECONNREFUSED|getaddrinfo/i.test(msg);
            // Continue to next candidate on DNS/connection issues
            if (!isDnsError) {
                // For non-network errors (e.g., auth), only try next if available
                continue;
            }
        }
    }

    console.error('Extended Backend - All MongoDB connection attempts failed. Please verify your MONGODB_URI or start local MongoDB.');
    process.exit(1);
};

// Handling MongoDB connection events
mongoose.connection.on('connected', () => {
    console.log('Extended Backend - Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.error(`Extended Backend - Mongoose connection error: ${err}`);
});

mongoose.connection.on('disconnected', () => {
    console.log('Extended Backend - Mongoose disconnected from MongoDB');
});

// Handle application termination
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('Extended Backend - MongoDB connection closed through app termination');
    process.exit(0);
});

module.exports = connectDB;


