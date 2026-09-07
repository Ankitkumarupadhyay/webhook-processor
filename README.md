# Reliable Webhook Processor

A production-grade, fault-tolerant webhook processing engine built with **NestJS**, **Sequelize ORM**, **PostgreSQL**, **BullMQ**, **Redis**, and **Next.js**.

The core objective of this application is **correctness under concurrency, duplicate protection, retries, crash recovery, and observability**.

---

## 1. Architecture

```text
Webhook (POST /webhooks)
       │
       ▼
 ┌───────────┐
 │ NestJS    │
 │ Backend   │
 └─────┬─────┘
       │ PostgreSQL Transaction
       ├─────────────────────────────────┐
       ▼                                 ▼
┌──────────────┐                 ┌──────────────┐
│webhook_events│ (eventId UNIQUE)│ outbox_jobs  │
└──────────────┘                 └──────┬───────┘
                                        │
                                        │ Outbox Dispatcher (Poller)
                                        ▼
                                 ┌──────────────┐
                                 │ Redis        │
                                 └──────┬───────┘
                                        │
                                        │ BullMQ Queue: webhook-processing
                                  ┌─────┴─────┐
                                  ▼           ▼
                             ┌─────────┐ ┌─────────┐
                             │worker-1 │ │worker-2 │
                             └────┬────┘ └────┬────┘
                                  │           │
                                  └─────┬─────┘
                                        │ PostgreSQL Transaction
                                        ├────────────────────────────────┬──────────────────────┐
                                        ▼                                ▼                      ▼
                               ┌─────────────────┐             ┌──────────────────┐    ┌───────────────────┐
                               │ processed_orders│ (eventId UNQ)│  webhook_events  │    │processing_attempts│
                               └─────────────────┘             └──────────────────┘    └───────────────────┘
```

### Services Overview
* **`postgres`**: PostgreSQL database (port 5432) — absolute source of truth.
* **`redis`**: Redis server (port 6379) — queue transport backend for BullMQ.
* **`backend`**: NestJS HTTP ingestion API, Operations API, and Outbox Dispatcher (port 3001).
* **`worker-1`**: NestJS BullMQ consumer process (`WORKER_ID=worker-1`).
* **`worker-2`**: NestJS BullMQ consumer process (`WORKER_ID=worker-2`).
* **`frontend`**: Next.js 14 Operations Dashboard (port 3000).

---

## 2. Setup & Execution

### Prerequisites
* Docker & Docker Compose installed.

### Quickstart

1. Clone repository & enter directory:
   ```bash
   git clone <repo-url>
   cd reliable-webhook-processor
   ```

2. Launch all services:
   ```bash
   docker compose up --build
   ```

3. Access interfaces:
   * **Dashboard**: [http://localhost:3000](http://localhost:3000)
   * **Backend API**: [http://localhost:3001](http://localhost:3001)
   * **PostgreSQL**: `localhost:5432` (`postgres:postgres`, database `webhook_processor`)
   * **Redis**: `localhost:6379`

---

## 3. Correctness Guarantees

### At-Least-Once Delivery + Idempotent Business Action = Effectively Exactly-Once Result

1. **Duplicate Webhook Delivery**:
   * Protected by database-level constraint `webhook_events.eventId UNIQUE`.
   * Concurrent duplicate HTTP requests safely resolve to the existing event and return an idempotent `200 OK` without creating duplicate outbox jobs.

2. **Duplicate Business Execution**:
   * Protected by database-level constraint `processed_orders.eventId UNIQUE`.
   * For every successfully processed event, `processed_orders` contains **exactly ONE row**.
   * If multiple workers or retries attempt to insert into `processed_orders`, PostgreSQL's unique constraint triggers an idempotency catch, preventing duplicate orders.

3. **Concurrent Workers**:
   * Workers claim events using PostgreSQL row locking (`SELECT FOR UPDATE SKIP LOCKED`).
   * Only one worker can transition an event from `PENDING`/`RETRYING` to `PROCESSING`.

4. **Worker Crash & Recovery**:
   * If a worker container dies mid-execution, `RecoveryService` identifies events stuck in `PROCESSING` longer than `PROCESSING_STALE_TIMEOUT_SECONDS` (default: 30s).
   * Stale events are safely transitioned back to `RETRYING`, an attempt is logged as `CRASHED`, and re-enqueued into BullMQ.

5. **Failure Simulation Rules (`data.simulate`)**:
   * `ok` (default): processes immediately and succeeds.
   * `fail_then_succeed:N`: fails for the first $N$ attempts with an error, then succeeds on attempt $N+1$.
   * `always_fail`: continuously fails until `MAX_ATTEMPTS` (default: 5) is reached, transitioning event status to `FAILED`.
   * `slow:N`: pauses worker execution for $N$ seconds to test concurrent worker locking and crash recovery timeouts.

---

## 4. Operational APIs

### Webhook Ingestion
* **`POST /webhooks`**
  ```json
  {
    "eventId": "evt_1001",
    "type": "order.created",
    "data": {
      "orderId": "ORD-1001",
      "simulate": "fail_then_succeed:2"
    }
  }
  ```

### Dashboard APIs
* **`GET /events?page=1&limit=20`**: List events with status, attempt count, and last error.
* **`GET /events/:eventId`**: Fetch event details, raw payload, and full attempt history.
* **`POST /events/:eventId/retry`**: Reset a `FAILED` event to `RETRYING` and re-enqueue for manual retry.

---

## 5. Demonstration Scripts

Executable test scripts are available in the `scripts/` directory:

```bash
# 1. Test concurrent duplicate ingestion & business action protection
./scripts/duplicate-test.sh

# 2. Test temporary failure retries (fail_then_succeed:2)
./scripts/temporary-failure.sh

# 3. Test permanent failure stopping at MAX_ATTEMPTS
./scripts/permanent-failure.sh

# 4. Test parallel processing across worker-1 and worker-2
./scripts/parallel-processing.sh

# 5. Test worker crash and stale recovery
./scripts/crash-recovery.sh

# 6. Test high concurrency burst (500 events)
./scripts/burst-500.sh
```

---

## 6. Automated Unit & Integration Tests

Run unit/integration tests with Jest:

```bash
cd backend
npm test
```

Tests verify:
1. **Concurrent Duplicate Protection**: 10 simultaneous webhook ingestions and 10 simultaneous worker executions yield exactly 1 `processed_orders` row.
2. **Retry Progression**: `fail_then_succeed:2` produces Attempt 1 (RETRYING), Attempt 2 (RETRYING), Attempt 3 (SUCCEEDED), and exactly 1 order row.
3. **Crash Recovery**: Stale `PROCESSING` event is detected, recovered, and completed without duplicate records.

---

## 7. Known Limitations

1. **At-Least-Once Execution**: The system delivers effectively-once business results through PostgreSQL constraints, not true distributed single-delivery execution.
2. **Recovery Overlap**: If a legitimate job takes longer than `PROCESSING_STALE_TIMEOUT_SECONDS`, the recovery service may flag it as stale while it is still running. However, `processed_orders.eventId UNIQUE` ensures no duplicate order row is created.
3. **Outbox At-Least-Once Dispatch**: The outbox dispatcher may enqueue a BullMQ job more than once if it restarts mid-dispatch. Worker idempotency handles duplicate jobs safely.

---

## 8. Hardest Bug Encountered

* **Problem**: When 10 duplicate HTTP webhook requests arrived simultaneously, two PostgreSQL transactions attempted `WebhookEvent.create()` concurrently, leading to race conditions where both checked existence before insertion.
* **Root Cause**: Non-atomic read-then-write logic allowed parallel transactions to pass existence checks before either committed.
* **Fix**: Implemented a database-level `UNIQUE` constraint on `webhook_events.eventId` combined with catching Sequelize's `UniqueConstraintError` inside the ingestion service to return an idempotent successful response.

---

## 9. Future Enhancements

1. **Distributed Locks**: Use Redis Redlock or Postgres advisory locks for lease renewal on long-running jobs.
2. **Dead Letter Queue (DLQ)**: Dedicated DLQ monitoring interface for non-retryable errors.
3. **Prometheus & Grafana Observability**: Export queue metrics, throughput, and error rates.
4. **API Authentication & HMAC Signatures**: Webhook signature verification (`X-Webhook-Signature`).
