import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';

async function start() {
  try {
    await connectDatabase();
    
    const server = createApp();
    
    server.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
      console.log(`Health check: http://localhost:${env.PORT}/health`);
      console.log(`Metrics: http://localhost:${env.PORT}/metrics`);
      console.log(`Socket.IO: ws://localhost:${env.PORT}/ws`);
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();