FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts=false
COPY apps/web apps/web
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3030 HOST=0.0.0.0 TEAMS_DB_PATH=/data/teams.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/server/src apps/server/src
COPY scripts/backup.mjs scripts/backup.mjs
COPY --from=build /app/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3030/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/server/src/index.mjs"]
