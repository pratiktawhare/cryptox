const mongoose = require('mongoose');
const config = require('./env');

async function connectDB() {
    try {
        await mongoose.connect(config.mongoUri);
        console.log('✅ MongoDB connected:', config.mongoUri.replace(/\/\/.*@/, '//<credentials>@'));
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }

    mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB reconnected');
    });
}

module.exports = connectDB;
