import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { WebhookModule } from './webhook/webhook.module';
import { EventsModule } from './events/events.module';
import { OutboxModule } from './outbox/outbox.module';
import { RecoveryModule } from './recovery/recovery.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    QueueModule,
    WebhookModule,
    EventsModule,
    OutboxModule,
    RecoveryModule,
  ],
})
export class AppModule {}
