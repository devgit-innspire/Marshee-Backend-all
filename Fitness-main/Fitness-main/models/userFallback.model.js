const mongoose = require('mongoose');

/**
 * User model - flexible schema to work with existing database
 */
const userSchema = new mongoose.Schema(
    {},
    {
        strict: false,
        collection: 'users',
        timestamps: false
    }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

