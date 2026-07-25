# Stage 1: Build dependencies
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci
COPY . .
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2: Production dependencies
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
# Install ONLY production dependencies to keep image small
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

# Stage 3: Runner
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

# node:20-alpine already ships an unprivileged "node" user (uid/gid 1000).
# Own the app directory so it (and everything copied into it below) is
# writable/readable by that user instead of root.
RUN chown node:node /app

# Copy necessary files from builder and prod-deps, owned by the unprivileged
# "node" user so the container does not run as root.
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/prisma ./prisma

# Drop root privileges before running the app / migrations.
USER node

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
