import { Module, Global } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { WebhookEvent } from './models/webhook-event.model';
import { ProcessedOrder } from './models/processed-order.model';
import { ProcessingAttempt } from './models/processing-attempt.model';
import { OutboxJob } from './models/outbox-job.model';

export const SEQUELIZE_PROVIDER = 'SEQUELIZE';

@Global()
@Module({
  providers: [
    {
      provide: SEQUELIZE_PROVIDER,
      useFactory: async () => {
        const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/webhook_processor';
        const sequelize = new Sequelize(dbUrl, {
          dialect: 'postgres',
          logging: false, // Set to console.log for debug
          models: [WebhookEvent, ProcessedOrder, ProcessingAttempt, OutboxJob],
          pool: {
            max: 20,
            min: 2,
            acquire: 30000,
            idle: 10000,
          },
        });

        // Ensure tables exist
        await sequelize.sync({ alter: true });
        return sequelize;
      },
    },
  ],
  exports: [SEQUELIZE_PROVIDER],
})
export class DatabaseModule {}
