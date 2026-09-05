const mongoose = require('mongoose');

/**
 * Pet model - flexible schema to work with existing database
 */
const petSchema = new mongoose.Schema(
    {},
    {
        strict: false,
        collection: 'pets',
        timestamps: false
    }
);

module.exports = mongoose.models.Pet || mongoose.model('Pet', petSchema);

