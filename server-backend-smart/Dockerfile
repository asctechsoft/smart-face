# ============================================================================
#  SmartFace Backend Core — multi-stage build
#  Cùng một image dùng cho cả pod API và pod worker, khác nhau ở CMD + WORKER_ENABLED.
# ============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Chạy bằng user không phải root.
RUN addgroup -g 1001 -S nodejs && adduser -S smartface -u 1001 \
    && chown -R smartface:nodejs /app
USER smartface

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# tini xử lý tín hiệu để graceful shutdown hoạt động đúng.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
