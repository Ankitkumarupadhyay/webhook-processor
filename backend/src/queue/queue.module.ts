import { Module, Global } from '@nestjs/common';
import { Queue } from 'bullmq';

export const BULLMQ_QUEUE_PROVIDER = 'BULLMQ_QUEUE';
export const QUEUE_NAME = 'webhook-processing';

@Global()
@Module({
  providers: [
    {
      provide: BULLMQ_QUEUE_PROVIDER,
      useFactory: () => {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        return new Queue(QUEUE_NAME, {
          connection: {
            host,
            port,
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        });
      },
    },
  ],
  exports: [BULLMQ_QUEUE_PROVIDER],
})
export class QueueModule {}
