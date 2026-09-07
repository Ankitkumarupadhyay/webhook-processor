import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { WebhookEvent } from '../database/models/webhook-event.model';
import { ProcessingAttempt } from '../database/models/processing-attempt.model';
import { OutboxJob } from '../database/models/outbox-job.model';
import { WebhookEventStatus, OutboxJobStatus } from '../database/enums';
import { Sequelize } from 'sequelize-typescript';
import { SEQUELIZE_PROVIDER } from '../database/database.module';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @Inject(SEQUELIZE_PROVIDER)
    private readonly sequelize: Sequelize,
  ) {}

  async listEvents(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const { rows, count } = await WebhookEvent.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit,
      offset,
      attributes: ['id', 'eventId', 'type', 'status', 'attemptCount', 'maxAttempts', 'lastError', 'createdAt', 'updatedAt'],
    });

    return {
      data: rows,
      meta: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async getEventDetails(eventId: string) {
    const event = await WebhookEvent.findOne({
      where: { eventId },
      include: [
        {
          model: ProcessingAttempt,
          as: 'attempts',
          order: [['attempt_number', 'ASC']],
        },
      ],
    });

    if (!event) {
      throw new NotFoundException(`Event with eventId '${eventId}' not found.`);
    }

    return event;
  }

  async manualRetry(eventId: string) {
    const event = await WebhookEvent.findOne({ where: { eventId } });

    if (!event) {
      throw new NotFoundException(`Event '${eventId}' not found.`);
    }

    if (event.status !== WebhookEventStatus.FAILED) {
      throw new BadRequestException(
        `Only events with status '${WebhookEventStatus.FAILED}' can be manually retried. Current status is '${event.status}'.`,
      );
    }

    await this.sequelize.transaction(async (t) => {
      // 1. Reset event state to RETRYING, reset maxAttempts if needed (allow extra attempts)
      event.status = WebhookEventStatus.RETRYING;
      event.maxAttempts = event.attemptCount + parseInt(process.env.MAX_ATTEMPTS || '5', 10);
      event.lastError = null;
      event.failedAt = null;
      event.processingStartedAt = null;
      await event.save({ transaction: t });

      // 2. Insert OutboxJob to enqueue in BullMQ
      // Use unique job type or timestamped outbox to bypass BullMQ completed deduplication
      await OutboxJob.create(
        {
          eventId: event.eventId,
          jobType: `manual-retry-${Date.now()}`,
          status: OutboxJobStatus.PENDING,
        },
        { transaction: t },
      );
    });

    this.logger.log(`Manual retry initiated for eventId: ${eventId}`);
    return {
      success: true,
      message: `Event '${eventId}' queued for manual retry.`,
      status: WebhookEventStatus.RETRYING,
    };
  }
}
