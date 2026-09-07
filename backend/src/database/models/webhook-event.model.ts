import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  AllowNull,
  Unique,
  CreatedAt,
  UpdatedAt,
  HasMany,
} from 'sequelize-typescript';
import { WebhookEventStatus } from '../enums';
import { ProcessingAttempt } from './processing-attempt.model';

@Table({
  tableName: 'webhook_events',
  timestamps: true,
})
export class WebhookEvent extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  /**
   * The external event identifier — UNIQUE at database level.
   * This is the primary idempotency key for duplicate webhook delivery protection.
   */
  @Unique
  @Column({ type: DataType.STRING, allowNull: false, field: 'event_id' })
  declare eventId: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare type: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare data: Record<string, unknown>;

  @Default(WebhookEventStatus.PENDING)
  @Column({
    type: DataType.ENUM(...Object.values(WebhookEventStatus)),
    allowNull: false,
  })
  declare status: WebhookEventStatus;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'attempt_count' })
  declare attemptCount: number;

  @Default(5)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'max_attempts' })
  declare maxAttempts: number;

  @AllowNull(true)
  @Column({ type: DataType.TEXT, field: 'last_error' })
  declare lastError: string | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE, field: 'processing_started_at' })
  declare processingStartedAt: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE, field: 'completed_at' })
  declare completedAt: Date | null;

  @AllowNull(true)
  @Column({ type: DataType.DATE, field: 'failed_at' })
  declare failedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;

  @HasMany(() => ProcessingAttempt, { foreignKey: 'event_uuid', sourceKey: 'id' })
  declare attempts: ProcessingAttempt[];
}
