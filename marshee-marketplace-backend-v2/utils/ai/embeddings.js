const axios = require('axios');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function stableStringify(obj) {
  if (obj == null) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function buildSourceHash(sourceObj) {
  return sha256Hex(stableStringify(sourceObj));
}

function getConfig() {
  return {
    provider: (process.env.AI_EMBEDDINGS_PROVIDER || 'vertex').toLowerCase(),
    model: process.env.AI_EMBEDDINGS_MODEL || 'gemini-embedding-001',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    timeoutMs: Number(process.env.AI_EMBEDDINGS_TIMEOUT_MS || 15000),
    gcpProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '',
    gcpLocation: process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || 'us-central1',
  };
}

async function embedOpenAI(text) {
  const cfg = getConfig();
  if (!cfg.openaiApiKey) {
    const err = new Error('OPENAI_API_KEY is not set');
    err.statusCode = 503;
    throw err;
  }
  const input = String(text || '').slice(0, 12000);
  const res = await axios.post(
    `${cfg.openaiBaseUrl.replace(/\/+$/, '')}/embeddings`,
    { model: cfg.model, input },
    {
      timeout: cfg.timeoutMs,
      headers: {
        Authorization: `Bearer ${cfg.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const vec = res?.data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    const err = new Error('Embedding provider returned empty embedding');
    err.statusCode = 502;
    throw err;
  }
  return vec;
}

async function embedVertex(text) {
  const cfg = getConfig();
  if (!cfg.gcpProjectId) {
    const err = new Error('GOOGLE_CLOUD_PROJECT (or GCP_PROJECT_ID) is not set');
    err.statusCode = 503;
    throw err;
  }

  // Vertex AI Text Embeddings API (REST):
  // POST https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/publishers/google/models/MODEL:predict
  const endpoint = `https://${cfg.gcpLocation}-aiplatform.googleapis.com/v1/projects/${cfg.gcpProjectId}/locations/${cfg.gcpLocation}/publishers/google/models/${cfg.model}:predict`;

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    const err = new Error('Failed to acquire Google access token for Vertex AI');
    err.statusCode = 503;
    throw err;
  }

  // Keep payload small and within token limits; Vertex handles truncation by default.
  const content = String(text || '').slice(0, 20000);

  const res = await axios.post(
    endpoint,
    {
      instances: [{ content }],
      parameters: { autoTruncate: true },
    },
    {
      timeout: cfg.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    }
  );

  const vec = res?.data?.predictions?.[0]?.embeddings?.values;
  if (!Array.isArray(vec) || vec.length === 0) {
    const err = new Error('Vertex AI returned empty embedding');
    err.statusCode = 502;
    throw err;
  }
  return vec;
}

async function getEmbedding(text) {
  const cfg = getConfig();
  if (cfg.provider === 'vertex') return embedVertex(text);
  if (cfg.provider === 'openai') return embedOpenAI(text);
  const err = new Error(`Unsupported AI_EMBEDDINGS_PROVIDER: ${cfg.provider}`);
  err.statusCode = 400;
  throw err;
}

module.exports = {
  getEmbedding,
  getConfig,
  buildSourceHash,
};

