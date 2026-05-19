# ╔═══════════════════════════════════════════════════════════╗
# ║                     DOCKERFILE                            ║
# ║              RemesaFácil Backend                          ║
# ╚═══════════════════════════════════════════════════════════╝

FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (for caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "server.js"]
