#!/bin/bash

echo "🚀 Setting up Memecoin Analytics Docker Environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose > /dev/null 2>&1; then
    echo "❌ docker-compose not found. Please install Docker Compose."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please create one with:"
    echo "PORT=3305"
    echo "DATABASE_URL=file:./prisma/dev.db"
    echo "REDIS_URL=redis://cache:6379"
    echo "HELIUS_API_KEY=your_api_key_here"
    echo "POLL_MS=2000"
    exit 1
fi

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose down --volumes

# Build and start containers
echo "🔨 Building and starting containers..."
docker-compose up --build -d

# Wait for containers to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are healthy
echo "🔍 Checking service health..."
for i in {1..30}; do
    if curl -s http://localhost:3305/api/health > /dev/null 2>&1; then
        echo "✅ Services are ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Services failed to start. Check logs with: docker-compose logs"
        exit 1
    fi
    sleep 2
done

echo ""
echo "🎉 Setup complete! Your Memecoin Analytics environment is running:"
echo ""
echo "📊 Dashboard:    http://localhost:3305"
echo "🏥 Health:       http://localhost:3305/api/health"
echo "📈 Metrics:      http://localhost:3305/api/metrics"
echo "🔌 WebSocket:    ws://localhost:3305/ws"
echo "🗄️ Redis:        localhost:6380"
echo ""
echo "📋 Useful commands:"
echo "  View logs:     docker-compose logs -f"
echo "  Stop:          docker-compose down"
echo "  Restart:       docker-compose restart"
echo "  Clean setup:   docker-compose down --volumes && ./setup.sh"
echo ""