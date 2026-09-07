import { Module } from '@nestjs/common';
import { WorkerProcessorService } from './worker-processor.service';
import { WorkerConsumerService } from './worker-consumer.service';

@Module({
  providers: [WorkerProcessorService, WorkerConsumerService],
  exports: [WorkerProcessorService],
})
export class WorkerModule {}
