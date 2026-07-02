# ============================================
# Development stage (Debian-based for Prisma compatibility)
# ============================================
FROM node:20-slim AS dev

WORKDIR /app

# Install OpenSSL (required by Prisma)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Development command with hot reload
CMD ["npm", "run", "dev"]

# ============================================
# Builder stage
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client and build TypeScript
RUN npx prisma generate
RUN npm run build

# ============================================
# Production stage (Debian-based for Prisma compatibility)
# ============================================
FROM node:20-slim AS prod

WORKDIR /app

# Install OpenSSL (required by Prisma) and wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Security: Run as non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs nodejs

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Copy public static files (admin dashboard, etc.)
COPY public ./public

# Copy Apple StoreKit root CA certificates (public certs from apple.com/certificateauthority).
# Used by the App Store Server Notifications V2 verifier — see services/appleNotificationService.ts.
COPY certs ./certs

# Splash/announcement image directory (SPLASH_DIR). Normally bind-mounted from
# the host in docker-compose; pre-created here so the no-mount case still works.
RUN mkdir -p /app/splash

# Set ownership
RUN chown -R nodejs:nodejs /app

# Pre-create the logs directory owned by the app user. When the named logs
# volume mounts here, Docker initializes the empty volume from this directory —
# inheriting non-root ownership. Without this the volume is created root-owned
# and Winston (running as nodejs, uid 1001) throws EACCES on every boot,
# silently killing file logging. Must match LOG_DIR in docker-compose
# (/var/log/animationstation); a mismatch recreates the EACCES bug because the
# mount point wouldn't exist in the image and Docker makes it root-owned.
RUN mkdir -p /var/log/animationstation && chown -R nodejs:nodejs /var/log/animationstation

USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

# Production command
CMD ["node", "dist/index.js"]
