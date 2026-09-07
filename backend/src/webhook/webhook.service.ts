import { Injectable, Inject, Logger } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { WebhookEvent } from '../database/models/webhook-event.model';
import { OutboxJob } from '../database/models/outbox-job.model';
import { SEQUELIZE_PROVIDER } from '../database/database.module';
import { WebhookEventStatus, OutboxJobStatus } from '../database/enums';
import { UniqueConstraintError } from 'sequelize';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(SEQUELIZE_PROVIDER)
    private readonly sequelize: Sequelize,
  ) { }

  async ingestWebhook(dto: CreateWebhookDto): Promise<{ success: boolean; eventId: string; status: string; isDuplicate?: boolean }> {

    const existing = await WebhookEvent.findOne({ where: { eventId: dto.eventId } });
    if (existing) {
      this.logger.warn(`Duplicate webhook received for eventId: ${dto.eventId}`);
      return {
        success: true,
        eventId: dto.eventId,
        status: existing.status,
        isDuplicate: true,
      };
    }

    const maxAttempts = parseInt(process.env.MAX_ATTEMPTS || '5', 10);

    try {
      const result = await this.sequelize.transaction(async (t) => {
        // 1. Insert WebhookEvent
        const event = await WebhookEvent.create(
          {
            eventId: dto.eventId,
            type: dto.type,
            data: dto.data,
            status: WebhookEventStatus.PENDING,
            attemptCount: 0,
            maxAttempts,
          },
          { transaction: t },
        );

        // 2. Insert OutboxJob within the same transaction
        await OutboxJob.create(
          {
            eventId: dto.eventId,
            jobType: 'process-webhook',
            status: OutboxJobStatus.PENDING,
          },
          { transaction: t },
        );

        return event;
      });

      this.logger.log(`Ingested event ${result.eventId} [${result.status}]`);
      return {
        success: true,
        eventId: result.eventId,
        status: result.status,
      };
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        this.logger.warn(`Concurrent duplicate webhook received for eventId: ${dto.eventId}`);
        return {
          success: true,
          eventId: dto.eventId,
          status: WebhookEventStatus.PENDING,
          isDuplicate: true,
        };
      }
      this.logger.error(`Failed to ingest webhook ${dto.eventId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
