export enum WebhookEventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  RETRYING = 'RETRYING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export enum AttemptResult {
  STARTED = 'STARTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  CRASHED = 'CRASHED',
}

export enum OutboxJobStatus {
  PENDING = 'PENDING',
  DISPATCHED = 'DISPATCHED',
}
