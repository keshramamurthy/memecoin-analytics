#!/bin/sh
set -e

echo "🔧 Setting up environment..."

# Ensure the prisma directory exists and has proper permissions
mkdir -p /app/prisma
chown -R nodejs:nodejs /app/prisma /app/public /app/dist

# Generate Prisma client in the runtime environment
echo "📦 Generating Prisma client for runtime..."
su-exec nodejs npx prisma generate

# Set up database schema
echo "🗄️  Setting up database..."
su-exec nodejs npx prisma db push --accept-data-loss || echo "⚠️  Database setup skipped (may already exist)"

echo "✅ Environment setup complete!"

# Start the application as nodejs user
echo "🚀 Starting application..."
exec su-exec nodejs "$@"