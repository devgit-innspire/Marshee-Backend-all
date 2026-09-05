const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const { importExistingModels } = require('../utils/databaseConnection');
const config = require('../config/config');

// Initialize Firebase Admin if not already initialized (for fallback only)
if (!admin.apps.length) {
    try {
        // Try to use service account key if available
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
            : null;

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } else {
            // Use default credentials (for local development)
            admin.initializeApp();
        }
    } catch (error) {
        console.error('Firebase Admin initialization error:', error);
    }
}

const auth = async (req, res, next) => {
    try {
        let token;
        
        // Check for token in headers
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.'
            });
        }

        // Try JWT verification first (primary method)
        try {
            const jwtSecret = process.env.JWT_SECRET || config.jwtSecret || 'your-secret-key';
            const decoded = jwt.verify(token, jwtSecret);
            
            if (decoded && decoded.id) {
                // Check for specific user ID
                const targetUserId = '691eafe4599823147045af87';
                if (decoded.id.toString() === targetUserId) {
                    console.log('=== TARGET USER ID DETECTED IN JWT ===');
                    console.log('Decoded JWT:', JSON.stringify(decoded, null, 2));
                }
                
                // Get user from database using JWT token's user ID
                const { User } = importExistingModels();
                if (User) {
                    const user = await User.findById(decoded.id);
                    if (user) {
                        // Check for specific user ID
                        if (user._id.toString() === targetUserId) {
                            console.log('=== TARGET USER FOUND IN DATABASE ===');
                            console.log('User Details:', JSON.stringify({
                                _id: user._id,
                                firebaseUID: user.firebaseUID,
                                role: user.role,
                                email: user.email,
                                phoneNumber: user.phoneNumber,
                                fullUserObject: user.toObject ? user.toObject() : user
                            }, null, 2));
                        }
                        
                        req.user = {
                            id: user._id,
                            firebaseUID: user.firebaseUID || null,
                            role: user.role || 'user',
                            email: user.email || null,
                            phoneNumber: user.phoneNumber || null
                        };
                        
                        // Log if this is the target user
                        if (req.user.id.toString() === targetUserId) {
                            console.log('=== TARGET USER SET IN REQ.USER ===');
                            console.log('req.user:', JSON.stringify(req.user, null, 2));
                        }
                        
                        return next();
                    }
                }
                
                // If User model not available, use decoded token data
                req.user = {
                    id: decoded.id,
                    firebaseUID: decoded.firebaseUID || null,
                    role: decoded.role || 'user',
                    email: decoded.email || null,
                    phoneNumber: decoded.phoneNumber || null
                };
                
                // Log if this is the target user
                if (req.user.id.toString() === targetUserId) {
                    console.log('=== TARGET USER SET IN REQ.USER (FROM JWT) ===');
                    console.log('req.user:', JSON.stringify(req.user, null, 2));
                }
                
                return next();
            }
        } catch (jwtError) {
            // JWT verification failed, try Firebase as fallback
            console.log('JWT verification failed, trying Firebase:', jwtError.message);
        }

        // Fallback to Firebase verification (if JWT fails)
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            const { User } = importExistingModels();
            if (User) {
                const user = await User.findOne({ firebaseUID: decodedToken.uid });
                if (user) {
                    // Check for specific user ID
                    const targetUserId = '691eafe4599823147045af87';
                    if (user._id.toString() === targetUserId) {
                        console.log('=== TARGET USER FOUND VIA FIREBASE ===');
                        console.log('Firebase UID:', decodedToken.uid);
                        console.log('User Details:', JSON.stringify({
                            _id: user._id,
                            firebaseUID: user.firebaseUID,
                            role: user.role,
                            email: user.email,
                            phoneNumber: user.phoneNumber,
                            fullUserObject: user.toObject ? user.toObject() : user
                        }, null, 2));
                    }
                    
                    req.user = {
                        id: user._id,
                        firebaseUID: user.firebaseUID,
                        role: user.role,
                        email: user.email,
                        phoneNumber: user.phoneNumber
                    };
                    
                    // Log if this is the target user
                    if (req.user.id.toString() === targetUserId) {
                        console.log('=== TARGET USER SET IN REQ.USER (FROM FIREBASE) ===');
                        console.log('req.user:', JSON.stringify(req.user, null, 2));
                    }
                    
                    return next();
                }
            }
        } catch (firebaseError) {
            // Firebase verification also failed
            console.log('Firebase verification failed:', firebaseError.message);
        }

        // If both JWT and Firebase fail, reject the request
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({
            success: false,
            message: 'Invalid token or authentication failed'
        });
    }
};

module.exports = auth;


