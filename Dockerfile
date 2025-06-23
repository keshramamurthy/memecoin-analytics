FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies for building (including dev dependencies for TypeScript)
RUN npm ci --ignore-scripts && npm cache clean --force

COPY . .

RUN npx prisma generate
RUN npm run build

# Clean up dev dependencies after build
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:20-alpine AS runner

WORKDIR /app

# Install wget for health checks, su-exec for user switching, and OpenSSL for Prisma
RUN apk add --no-cache wget su-exec openssl

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3305

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]