import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import routes from './routes/index.js';
import { SocketService } from './services/socketService.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';

export function createApp() {
  const app = express();
  const httpServer = createServer(app);

  app.use(cors());
  app.use(express.json());
  app.use(metricsMiddleware);

  app.use('/', routes);

  new SocketService(httpServer);

  return httpServer;
}