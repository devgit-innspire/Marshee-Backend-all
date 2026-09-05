# Multi-stage build to produce a small and secure image for GCP (Cloud Run/GKE)
# Build stage (includes build tools for native modules if needed, e.g., bcrypt)
FROM node:20-slim AS builder

WORKDIR /app

# Install system deps required to compile native node modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies using package-lock for reproducible builds
COPY package*.json ./
# RUN npm ci --omit=dev
RUN npm install --omit=dev

# Copy source
COPY . .

# Runtime stage (no build tools, smaller surface)
FROM node:20-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080

# Use non-root user for better security
USER node

WORKDIR /app

# Copy only what's needed from builder
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/server.js ./server.js
COPY --chown=node:node --from=builder /app/config ./config
COPY --chown=node:node --from=builder /app/controllers ./controllers
COPY --chown=node:node --from=builder /app/middleware ./middleware
COPY --chown=node:node --from=builder /app/models ./models
COPY --chown=node:node --from=builder /app/routes ./routes
COPY --chown=node:node --from=builder /app/utils ./utils

# Cloud Run expects the service to listen on $PORT
EXPOSE 8080

# Prefer npm start if you have it, otherwise node server.js
# CMD ["npm", "start"]
CMD ["node", "server.js"]