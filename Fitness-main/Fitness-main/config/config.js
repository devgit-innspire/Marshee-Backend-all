module.exports = {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    jwtExpire: process.env.JWT_EXPIRE || '30d',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 5008
};


