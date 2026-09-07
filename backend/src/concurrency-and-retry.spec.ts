import { Test, TestingModule } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { DatabaseModule, SEQUELIZE_PROVIDER } from './database/database.module';
import { QueueModule, BULLMQ_QUEUE_PROVIDER } from './queue/queue.module';
import { WebhookService } from './webhook/webhook.service';
import { WorkerProcessorService } from './worker/worker-processor.service';
import { RecoveryService } from './recovery/recovery.service';
import { WebhookEvent } from './database/models/webhook-event.model';
import { ProcessedOrder } from './database/models/processed-order.model';
import { ProcessingAttempt } from './database/models/processing-attempt.model';
import { OutboxJob } from './database/models/outbox-job.model';
import { WebhookEventStatus } from './database/enums';

describe('Reliable Webhook Processor Integration Tests', () => {
  let moduleRef: TestingModule;
  let sequelize: Sequelize;
  let webhookService: WebhookService;
  let workerProcessorService: WorkerProcessorService;
  let recoveryService: RecoveryService;

  beforeAll(async () => {
    // Set test env
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/webhook_processor';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
    process.env.WORKER_ID = 'test-worker';

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, QueueModule],
      providers: [WebhookService, WorkerProcessorService, RecoveryService],
    }).compile();

    sequelize = moduleRef.get<Sequelize>(SEQUELIZE_PROVIDER);
    webhookService = moduleRef.get<WebhookService>(WebhookService);
    workerProcessorService = moduleRef.get<WorkerProcessorService>(WorkerProcessorService);
    recoveryService = moduleRef.get<RecoveryService>(RecoveryService);
  }, 30000);

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  beforeEach(async () => {
    // Clean tables before each test
    await ProcessingAttempt.destroy({ where: {}, truncate: true, cascade: true });
    await ProcessedOrder.destroy({ where: {}, truncate: true, cascade: true });
    await OutboxJob.destroy({ where: {}, truncate: true, cascade: true });
    await WebhookEvent.destroy({ where: {}, truncate: true, cascade: true });
  });

  describe('Test 1: Concurrent Duplicate Protection', () => {
    it('should enforce exactly one processed_orders row under 10 concurrent webhook & worker invocations', async () => {
      const eventId = 'test-dup-001';

      // 1. Send 10 concurrent webhook ingestion requests
      const ingestionPromises = Array.from({ length: 10 }).map(() =>
        webhookService.ingestWebhook({
          eventId,
          type: 'order.created',
          data: { orderId: 'ORD-DUP-001', simulate: 'ok' },
        }),
      );

      const ingestionResults = await Promise.all(ingestionPromises);

      // Verify only 1 webhook_events row was created
      const eventsCount = await WebhookEvent.count({ where: { eventId } });
      expect(eventsCount).toBe(1);

      // 2. Simulate 10 concurrent workers trying to process the event at the exact same moment
      const workerPromises = Array.from({ length: 10 }).map(() =>
        workerProcessorService.processEvent(eventId),
      );

      await Promise.all(workerPromises);

      // Verify business effect: EXACTLY ONE processed_order row
      const processedOrders = await ProcessedOrder.findAll({ where: { eventId } });
      expect(processedOrders.length).toBe(1);
      expect(processedOrders[0].orderId).toBe('ORD-DUP-001');

      // Verify event status is SUCCEEDED
      const event = await WebhookEvent.findOne({ where: { eventId } });
      expect(event?.status).toBe(WebhookEventStatus.SUCCEEDED);
    }, 15000);
  });

  describe('Test 2: Retry Behavior (fail_then_succeed:2)', () => {
    it('should retry twice and succeed on attempt 3 with exactly 1 processed_order', async () => {
      const eventId = 'test-retry-002';

      // Ingest webhook with fail_then_succeed:2
      await webhookService.ingestWebhook({
        eventId,
        type: 'order.created',
        data: { orderId: 'ORD-RETRY-002', simulate: 'fail_then_succeed:2' },
      });

      // Attempt 1: should fail
      await workerProcessorService.processEvent(eventId);
      let event = await WebhookEvent.findOne({ where: { eventId } });
      expect(event?.status).toBe(WebhookEventStatus.RETRYING);
      expect(event?.attemptCount).toBe(1);

      // Reset event status to RETRYING for synchronous unit test processing
      await workerProcessorService.processEvent(eventId);
      event = await WebhookEvent.findOne({ where: { eventId } });
      expect(event?.status).toBe(WebhookEventStatus.RETRYING);
      expect(event?.attemptCount).toBe(2);

      // Attempt 3: should succeed
      await workerProcessorService.processEvent(eventId);
      event = await WebhookEvent.findOne({ where: { eventId } });
      expect(event?.status).toBe(WebhookEventStatus.SUCCEEDED);
      expect(event?.attemptCount).toBe(3);

      // Assert processed_orders has exactly 1 row
      const processedOrders = await ProcessedOrder.findAll({ where: { eventId } });
      expect(processedOrders.length).toBe(1);

      // Assert 3 processing attempt history logs exist
      const attempts = await ProcessingAttempt.findAll({ where: { eventUuid: event?.id } });
      expect(attempts.length).toBe(3);
    }, 15000);
  });

  describe('Test 3: Crash Recovery for Stale Events', () => {
    it('should recover a stale PROCESSING event and allow worker to finish it idempotently', async () => {
      const eventId = 'test-crash-003';

      // Ingest event
      await webhookService.ingestWebhook({
        eventId,
        type: 'order.created',
        data: { orderId: 'ORD-CRASH-003', simulate: 'ok' },
      });

      // Manually set status = PROCESSING with start date 60s in the past (simulating crashed worker)
      const event = await WebhookEvent.findOne({ where: { eventId } });
      expect(event).toBeDefined();
      if (event) {
        event.status = WebhookEventStatus.PROCESSING;
        event.processingStartedAt = new Date(Date.now() - 60000);
        await event.save();
      }

      // Run recovery service
      await recoveryService.recoverStaleEvents();

      // Assert event was recovered back to RETRYING
      const recoveredEvent = await WebhookEvent.findOne({ where: { eventId } });
      expect(recoveredEvent?.status).toBe(WebhookEventStatus.RETRYING);

      // Process event after recovery
      await workerProcessorService.processEvent(eventId);

      // Assert business order processed safely
      const processedOrders = await ProcessedOrder.findAll({ where: { eventId } });
      expect(processedOrders.length).toBe(1);
    }, 15000);
  });
});
