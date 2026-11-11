FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
