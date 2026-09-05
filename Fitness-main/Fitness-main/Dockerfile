# syntax=docker/dockerfile:1

# Use a small, secure base image
FROM node:18-alpine AS base

ENV NODE_ENV=production \
    PORT=8080 \
    CSV_STORAGE_DIR=/app/data/csv_sessions

WORKDIR /app

# Install runtime tools for healthcheck and proper signal handling
RUN apk add --no-cache tini curl

# Install dependencies separately for better caching
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build stage (not building TS here; kept for parity/future use)
FROM base AS build
COPY --from=deps /app/node_modules /app/node_modules
COPY . .

# Final runtime image
FROM base AS runtime

# Copy app files and production node_modules as root first
COPY --from=deps /app/node_modules /app/node_modules
COPY . .

# Ensure CSV storage directory exists and set ownership to non-root user
RUN mkdir -p "$CSV_STORAGE_DIR" && chown -R node:node /app

# Drop privileges to node user for runtime
USER node

EXPOSE 8080

# HEALTHCHECK against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "server.js"]


