# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --omit=dev keeps the runtime image free of test and build tooling.
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Runs unprivileged: the process holds provider credentials and must not be root.
RUN addgroup -S synapse && adduser -S synapse -G synapse

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Vault, audit ledger and memories live here — mount a volume in production.
RUN mkdir -p /app/data && chown -R synapse:synapse /app
VOLUME ["/app/data"]

USER synapse
EXPOSE 3000

# Listen on all interfaces inside the container; publish selectively on the host.
ENV HOST=0.0.0.0 PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
