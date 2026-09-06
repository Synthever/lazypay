FROM node:20-alpine

WORKDIR /app

# Copy server package manifests
COPY server/package*.json ./server/

WORKDIR /app/server
RUN npm install --omit=dev

WORKDIR /app
# Copy application code
COPY server ./server
COPY client ./client

# Create persistent directories for SQLite/LowDB data and downloads
RUN mkdir -p /app/data /app/downloads

WORKDIR /app/server

ENV PORT=8940
ENV NODE_ENV=production

EXPOSE 8940

CMD ["node", "src/index.js"]
