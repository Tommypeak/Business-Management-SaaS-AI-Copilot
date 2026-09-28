# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.34.6
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-api,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
RUN pnpm --filter @saas/api generate && pnpm --filter @saas/api build
RUN pnpm --filter @saas/api deploy --legacy --prod /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=7s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
