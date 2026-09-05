// config/surveydb.ts
import mongoose from 'mongoose';

const surveyUri = process.env.MONGO_SURVEY_URI || process.env.MONGO_URI || '';

let surveyConnection: mongoose.Connection;

if (surveyUri) {
  surveyConnection = mongoose.createConnection(surveyUri);

  surveyConnection.on('connected', () => {
    console.log('✅ Connected to Survey Database');
  });

  surveyConnection.on('error', (err) => {
    console.error('❌ Survey DB connection error:', err);
  });
} else {
  console.warn(
    '⚠️  Neither MONGO_SURVEY_URI nor MONGO_URI is defined. Falling back to the primary mongoose connection. Survey features will use the main database.'
  );
  surveyConnection = mongoose.connection;
}

export { surveyConnection };
