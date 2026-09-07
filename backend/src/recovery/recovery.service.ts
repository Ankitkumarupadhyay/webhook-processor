import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { WebhookEvent } from '../database/models/webhook-event.model';
import { OutboxJob } from '../database/models/outbox-job.model';
import { ProcessingAttempt } from '../database/models/processing-attempt.model';
import { WebhookEventStatus, OutboxJobStatus, AttemptResult } from '../database/enums';
import { SEQUELIZE_PROVIDER } from '../database/database.module';

@Injectable()
export class RecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    @Inject(SEQUELIZE_PROVIDER)
    private readonly sequelize: Sequelize,
  ) {}

  onModuleInit() {
    // Run crash recovery check every 15 seconds
    this.logger.log('Starting Crash Recovery Service');
    this.timer = setInterval(() => this.recoverStaleEvents(), 15000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async recoverStaleEvents() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const timeoutSeconds = parseInt(process.env.PROCESSING_STALE_TIMEOUT_SECONDS || '30', 10);
      const staleThreshold = new Date(Date.now() - timeoutSeconds * 1000);

      const staleEvents = await WebhookEvent.findAll({
        where: {
          status: WebhookEventStatus.PROCESSING,
          processingStartedAt: {
            [Op.lt]: staleThreshold,
          },
        },
      });

      for (const event of staleEvents) {
        this.logger.warn(`Found stale event stuck in PROCESSING: ${event.eventId} (started at: ${event.processingStartedAt})`);

        await this.sequelize.transaction(async (t) => {
          // Record CRASHED attempt for observability
          await ProcessingAttempt.create(
            {
              eventUuid: event.id,
              attemptNumber: event.attemptCount,
              workerId: 'recovery-service',
              startedAt: event.processingStartedAt || new Date(),
              finishedAt: new Date(),
              result: AttemptResult.CRASHED,
              error: `Worker crashed or stalled (> ${timeoutSeconds}s)`,
            },
            { transaction: t },
          );

          // Transition state back to RETRYING
          event.status = WebhookEventStatus.RETRYING;
          event.processingStartedAt = null;
          await event.save({ transaction: t });

          // Re-enqueue outbox job
          await OutboxJob.create(
            {
              eventId: event.eventId,
              jobType: 'stale-recovery',
              status: OutboxJobStatus.PENDING,
            },
            { transaction: t },
          );
        });

        this.logger.log(`Successfully recovered stale event: ${event.eventId}`);
      }
    } catch (err) {
      this.logger.error(`Error running recovery check: ${(err as Error).message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
