# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# NobatYar – production image (Next.js standalone, multi-stage)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ── dependencies (cached by lockfile) ───────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# ── build ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
# Prisma needs the schema at build time to generate the client
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_BUILD_ID=$RANDOM
RUN npm run build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
