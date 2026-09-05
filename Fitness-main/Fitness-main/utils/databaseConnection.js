const mongoose = require('mongoose');
const path = require('path');

// Connect to the same MongoDB database as your main backend
const connectToExistingDB = async () => {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pets_ecommerce';
        
        // Check if URI is SRV format and suggest alternatives
        if (uri.includes('mongodb+srv://')) {
            console.log('Using MongoDB Atlas SRV connection string...');
        }
        
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000, // 10 seconds timeout
            socketTimeoutMS: 45000, // 45 seconds socket timeout
        });
        
        console.log('Extended Backend - Connected to existing pets_ecommerce database');
        return mongoose.connection;
    } catch (error) {
        console.error('Extended Backend - Database connection error:', error);
        
        // Provide helpful error messages
        if (error.message.includes('querySrv') || error.message.includes('EREFUSED')) {
            console.error('\n⚠️  DNS Resolution Error - Possible fixes:');
            console.error('1. Check your MONGODB_URI in .env file');
            console.error('2. Verify MongoDB Atlas cluster is running (not paused)');
            console.error('3. Check network/DNS settings or try different DNS server');
            console.error('4. Try using standard connection string instead of SRV format');
            console.error('5. Check MongoDB Atlas IP whitelist includes your IP');
        }
        
        // Don't exit immediately - allow retry
        throw error;
    }
};

// Import Pet and User models (using local models that work with existing database)
const importExistingModels = () => {
    try {
        const User = require('../models/userFallback.model');
        const Pet = require('../models/petFallback.model');
        return { User, Pet };
    } catch (error) {
        console.error('Extended Backend - Failed to load models:', error);
        return { User: null, Pet: null };
    }
};

module.exports = {
    connectToExistingDB,
    importExistingModels
};


