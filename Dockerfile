# Stage 1: Build dependencies
FROM node:20-alpine AS builder
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
WORKDIR /app
COPY package.json package-lock.json ./
# Install ONLY production dependencies to keep image small
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy necessary files from builder and prod-deps
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
