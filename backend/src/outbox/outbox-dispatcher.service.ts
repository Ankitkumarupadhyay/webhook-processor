import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OutboxJob } from '../database/models/outbox-job.model';
import { OutboxJobStatus } from '../database/enums';
import { BULLMQ_QUEUE_PROVIDER } from '../queue/queue.module';

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    @Inject(BULLMQ_QUEUE_PROVIDER)
    private readonly queue: Queue,
  ) {}

  onModuleInit() {
    const interval = parseInt(process.env.OUTBOX_POLL_INTERVAL_MS || '1000', 10);
    this.logger.log(`Starting Outbox Dispatcher (interval: ${interval}ms)`);
    this.timer = setInterval(() => this.dispatchPendingJobs(), interval);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async dispatchPendingJobs() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pendingJobs = await OutboxJob.findAll({
        where: { status: OutboxJobStatus.PENDING },
        limit: 50,
        order: [['created_at', 'ASC']],
      });

      for (const outboxRecord of pendingJobs) {
        try {
          // Use deterministic jobId to prevent duplicate BullMQ enqueues
          const jobId = `process-event-${outboxRecord.eventId}`;
          await this.queue.add(
            'process-webhook',
            { eventId: outboxRecord.eventId },
            {
              jobId,
              attempts: 1, // Retries managed explicitly by DB + BullMQ, not implicit worker loop
              removeOnComplete: true,
            },
          );

          outboxRecord.status = OutboxJobStatus.DISPATCHED;
          outboxRecord.processedAt = new Date();
          await outboxRecord.save();

          this.logger.log(`Dispatched outbox job for eventId: ${outboxRecord.eventId}`);
        } catch (err) {
          this.logger.error(`Error dispatching outbox job ${outboxRecord.id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Error querying pending outbox jobs: ${(err as Error).message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
