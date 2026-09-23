ARG NODE_VERSION=24
# -----------------------------------------------------------------------------
# Stage 1: Builder - Install dependencies and compile native modules
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Rebuild native modules for current Node.js version
RUN npm rebuild better-sqlite3

# -----------------------------------------------------------------------------
# Stage 2: Production - Minimal runtime image
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS production

# Install runtime dependencies only
RUN apk add --no-cache \
    sqlite

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy package.json for version info
COPY package*.json ./

# Copy application source
COPY src/ ./src/

# Create data directory for SQLite database and set permissions
RUN mkdir -p /app/data && \
    chown nodejs:nodejs /app/data

ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/db.sqlite \
    HEALTH_PORT=3000

# Switch to non-root user
USER nodejs

# Liveness only: a stalled update loop, not a Discord outage. No EXPOSE and no
# published port, since HEALTH_HOST is loopback and this check is the only thing
# that reaches it. busybox wget beats spawning a second Node every minute.
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
    CMD wget -q -O- "http://127.0.0.1:${HEALTH_PORT}/health" || exit 1

# Run the bot
CMD ["node", "src/index.js"]