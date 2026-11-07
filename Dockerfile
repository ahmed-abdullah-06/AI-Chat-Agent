# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- runtime image ---------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY server ./server
COPY dist ./dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
