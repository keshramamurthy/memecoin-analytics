import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { SocketService } from './services/socketService.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  const httpServer = createServer(app);

  app.use(cors());
  app.use(express.json());
  app.use(metricsMiddleware);

  // Serve static files from public directory
  const publicPath = path.join(__dirname, '..', 'public');
  app.use(express.static(publicPath));

  // API routes
  app.use('/api', routes);
  
  // Serve the dashboard at root
  app.get('/', (_, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  new SocketService(httpServer);

  return httpServer;
}