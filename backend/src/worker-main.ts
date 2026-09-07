import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerAppModule } from './worker-app.module';

async function bootstrapWorker() {
  const workerId = process.env.WORKER_ID || 'worker-unknown';
  const logger = new Logger(`WorkerMain:${workerId}`);

  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  logger.log(`Worker process [${workerId}] initialized and listening for jobs.`);

  // Enable graceful shutdown
  app.enableShutdownHooks();
}
bootstrapWorker();
