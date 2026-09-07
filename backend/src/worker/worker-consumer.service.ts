import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { WorkerProcessorService } from './worker-processor.service';
import { QUEUE_NAME } from '../queue/queue.module';

@Injectable()
export class WorkerConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerConsumerService.name);
  private worker: Worker | null = null;

  constructor(private readonly processorService: WorkerProcessorService) {}

  onModuleInit() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const workerId = process.env.WORKER_ID || 'worker-unknown';

    this.logger.log(`Starting BullMQ Worker [${workerId}] on queue '${QUEUE_NAME}'`);

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<{ eventId: string }>) => {
        const { eventId } = job.data;
        this.logger.log(`Worker [${workerId}] picked up job ${job.id} for event: ${eventId}`);
        await this.processorService.processEvent(eventId);
      },
      {
        connection: { host, port },
        concurrency: 1, // Concurrency 1 per container for clean parallel demonstration
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`BullMQ job ${job?.id} failed with error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      this.logger.log('Closing BullMQ worker cleanly...');
      await this.worker.close();
    }
  }
}
