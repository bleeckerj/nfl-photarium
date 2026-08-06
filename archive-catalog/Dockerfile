FROM node:25-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends exiftool \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm install --include=dev && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV ARCHIVE_DATABASE_PATH=/data/catalog.sqlite
ENV ARCHIVE_PREVIEW_ROOT=/data/previews
ENV ARCHIVE_BACKUP_ROOT=/data/backups
ENV ARCHIVE_SOURCE_ROOT=/sources/photography-1
EXPOSE 8790

CMD ["node", "dist/server.js"]
