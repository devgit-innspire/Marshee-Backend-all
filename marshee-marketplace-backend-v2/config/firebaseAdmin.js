const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  try {
    // Prefer a credentials JSON file to avoid .env newline/PEM parsing issues.
    const credentialsFileFromEnv = process.env.FIREBASE_CREDENTIALS_FILE || process.env.GCS_KEY_FILE;
    const defaultCredentialsFile = path.join(__dirname, "gcs-storage-access.json");
    const credentialsFilePath = credentialsFileFromEnv
      ? path.resolve(process.cwd(), credentialsFileFromEnv)
      : defaultCredentialsFile;

    let serviceAccount = null;

    if (fs.existsSync(credentialsFilePath)) {
      const raw = fs.readFileSync(credentialsFilePath, "utf8");
      serviceAccount = JSON.parse(raw);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, "\n");
      }
      console.log(`Firebase Admin: using credentials file at ${credentialsFilePath}`);
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";
      if (
        (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
        (privateKey.startsWith("'") && privateKey.endsWith("'"))
      ) {
        privateKey = privateKey.slice(1, -1);
      }
      privateKey = privateKey.replace(/\\n/g, "\n");

      serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: privateKey,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        universe_domain: "googleapis.com",
      };
      console.log("Firebase Admin: using FIREBASE_* env credentials");
    } else {
      console.warn("Firebase Admin: no credentials file found and FIREBASE_* env vars are incomplete.");
      console.warn("Set FIREBASE_CREDENTIALS_FILE (or GCS_KEY_FILE), or FIREBASE_PROJECT_ID/FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL.");
    }

    if (serviceAccount) {
      const bucket =
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.GCS_BUCKET ||
        `${serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID}.appspot.com`;

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucket,
      });
    }
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
    // Don't throw - allow server to start even if Firebase fails
    // Individual endpoints will handle the error
  }
}

module.exports = admin;