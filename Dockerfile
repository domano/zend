FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY server/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server files
COPY server/ ./server/

# Copy frontend files
COPY index.html ./
COPY game.js ./
COPY public/ ./public/

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server/server.js"]

