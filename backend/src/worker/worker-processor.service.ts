import { Injectable, Inject, Logger } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { UniqueConstraintError, Transaction, Op } from 'sequelize';
import { WebhookEvent } from '../database/models/webhook-event.model';
import { ProcessedOrder } from '../database/models/processed-order.model';
import { ProcessingAttempt } from '../database/models/processing-attempt.model';
import { WebhookEventStatus, AttemptResult } from '../database/enums';
import { SEQUELIZE_PROVIDER } from '../database/database.module';
import { Queue } from 'bullmq';
import { BULLMQ_QUEUE_PROVIDER } from '../queue/queue.module';

@Injectable()
export class WorkerProcessorService {
  private readonly logger = new Logger(WorkerProcessorService.name);
  private readonly workerId: string;

  constructor(
    @Inject(SEQUELIZE_PROVIDER)
    private readonly sequelize: Sequelize,
    @Inject(BULLMQ_QUEUE_PROVIDER)
    private readonly queue: Queue,
  ) {
    this.workerId = process.env.WORKER_ID || 'worker-unknown';
  }

  async processEvent(eventId: string): Promise<void> {
    this.logger.log(`[${this.workerId}] Job received for eventId: ${eventId}`);

    // Step 1 & 2: Check event & terminal state
    const existingEvent = await WebhookEvent.findOne({ where: { eventId } });
    if (!existingEvent) {
      this.logger.warn(`[${this.workerId}] Event ${eventId} not found in database. Skipping.`);
      return;
    }

    if (existingEvent.status === WebhookEventStatus.SUCCEEDED) {
      this.logger.log(`[${this.workerId}] Event ${eventId} is already SUCCEEDED. Skipping.`);
      return;
    }

    // Step 3: Atomically claim processing
    const claimedInfo = await this.claimEvent(eventId);
    if (!claimedInfo) {
      this.logger.log(`[${this.workerId}] Could not claim event ${eventId} (already being processed by another worker or completed).`);
      return;
    }

    const { event, attemptNumber } = claimedInfo;

    // Step 4: Create ProcessingAttempt record (STARTED)
    const attemptRecord = await ProcessingAttempt.create({
      eventUuid: event.id,
      attemptNumber,
      workerId: this.workerId,
      startedAt: new Date(),
      result: AttemptResult.STARTED,
    });

    // Step 5 & 6: Execute business logic with failure simulation
    try {
      await this.runSimulation(event.data?.simulate, attemptNumber);

      // Business logic transaction
      await this.sequelize.transaction(async (t) => {
        // Insert into processed_orders — eventId UNIQUE constraint is ultimate protection
        try {
          const orderId = (event.data?.orderId as string) || `ORD-${event.eventId}`;
          await ProcessedOrder.create(
            {
              orderId,
              eventId: event.eventId,
              processedAt: new Date(),
            },
            { transaction: t },
          );
          this.logger.log(`[${this.workerId}] Successfully inserted processed_order for event ${eventId}`);
        } catch (err) {
          if (err instanceof UniqueConstraintError) {
            this.logger.warn(
              `[${this.workerId}] ProcessedOrder already exists for event ${eventId}. Idempotency protection triggered!`,
            );
          } else {
            throw err;
          }
        }

        // Mark WebhookEvent SUCCEEDED
        event.status = WebhookEventStatus.SUCCEEDED;
        event.completedAt = new Date();
        event.lastError = null;
        await event.save({ transaction: t });

        // Update ProcessingAttempt SUCCEEDED
        attemptRecord.finishedAt = new Date();
        attemptRecord.result = AttemptResult.SUCCEEDED;
        await attemptRecord.save({ transaction: t });
      });

      this.logger.log(`[${this.workerId}] Event ${eventId} successfully processed!`);
    } catch (error) {
      const errMessage = (error as Error).message;
      this.logger.warn(`[${this.workerId}] Processing failed for event ${eventId} (Attempt ${attemptNumber}): ${errMessage}`);

      await this.handleFailure(event, attemptRecord, attemptNumber, errMessage);
    }
  }

  /**
   * Atomically claim the event for processing using row locking (FOR UPDATE SKIP LOCKED)
   */
  private async claimEvent(eventId: string): Promise<{ event: WebhookEvent; attemptNumber: number } | null> {
    try {
      return await this.sequelize.transaction(
        { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
        async (t) => {
          const event = await WebhookEvent.findOne({
            where: {
              eventId,
              status: {
                [Op.in]: [WebhookEventStatus.PENDING, WebhookEventStatus.RETRYING],
              },
            },
            lock: Transaction.LOCK.UPDATE,
            skipLocked: true,
            transaction: t,
          });

          if (!event) return null;

          event.status = WebhookEventStatus.PROCESSING;
          event.attemptCount += 1;
          event.processingStartedAt = new Date();
          await event.save({ transaction: t });

          return { event, attemptNumber: event.attemptCount };
        },
      );
    } catch (err) {
      this.logger.error(`[${this.workerId}] Error claiming event ${eventId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Parse and run simulation logic.
   * Robust handling for:
   * - ok
   * - fail_then_succeed:N (fails for attempts <= N)
   * - always_fail
   * - slow:N (sleeps N seconds)
   */
  private async runSimulation(simulateRaw: unknown, currentAttempt: number): Promise<void> {
    if (!simulateRaw || typeof simulateRaw !== 'string') return;

    const sim = simulateRaw.trim();

    if (sim === 'ok') return;

    if (sim === 'always_fail') {
      throw new Error('Simulation rule triggered: always_fail');
    }

    if (sim.startsWith('fail_then_succeed:')) {
      const parts = sim.split(':');
      const failCount = parseInt(parts[1], 10);
      const safeFailCount = isNaN(failCount) || failCount < 0 ? 1 : failCount;

      if (currentAttempt <= safeFailCount) {
        throw new Error(`Simulation rule triggered: fail_then_succeed (${currentAttempt}/${safeFailCount})`);
      }
      return;
    }

    if (sim.startsWith('slow:')) {
      const parts = sim.split(':');
      const seconds = parseInt(parts[1], 10);
      const safeSeconds = isNaN(seconds) || seconds < 0 ? 5 : seconds;
      this.logger.log(`[${this.workerId}] Simulation rule: slow for ${safeSeconds} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, safeSeconds * 1000));
      return;
    }
  }

  /**
   * Handle worker execution failure: update attempts, evaluate maxAttempts, schedule retry.
   */
  private async handleFailure(
    event: WebhookEvent,
    attemptRecord: ProcessingAttempt,
    attemptNumber: number,
    errorMessage: string,
  ): Promise<void> {
    const isPermanentFailure = attemptNumber >= event.maxAttempts;
    const newStatus = isPermanentFailure ? WebhookEventStatus.FAILED : WebhookEventStatus.RETRYING;

    await this.sequelize.transaction(async (t) => {
      // Update Event status
      event.status = newStatus;
      event.lastError = errorMessage;
      if (isPermanentFailure) {
        event.failedAt = new Date();
      }
      await event.save({ transaction: t });

      // Update Attempt Record
      attemptRecord.finishedAt = new Date();
      attemptRecord.result = isPermanentFailure ? AttemptResult.FAILED : AttemptResult.RETRYING;
      attemptRecord.error = errorMessage;
      await attemptRecord.save({ transaction: t });
    });

    if (!isPermanentFailure) {
      // Exponential backoff delay
      const baseDelay = parseInt(process.env.RETRY_DELAY_MS || '1000', 10);
      const delay = baseDelay * Math.pow(2, attemptNumber - 1);

      this.logger.log(`[${this.workerId}] Scheduling retry for event ${event.eventId} in ${delay}ms`);

      // Add retry job to BullMQ with delay
      await this.queue.add(
        'process-webhook',
        { eventId: event.eventId },
        {
          delay,
          jobId: `process-event-${event.eventId}-attempt-${attemptNumber + 1}`,
          removeOnComplete: true,
        },
      );
    } else {
      this.logger.error(`[${this.workerId}] Event ${event.eventId} reached MAX_ATTEMPTS (${event.maxAttempts}). Marked as FAILED.`);
    }
  }
}
