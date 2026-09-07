import {
  Table,
  Column,
  Model,
  DataType,
  AllowNull,
  ForeignKey,
  BelongsTo,
  CreatedAt,
  Index,
} from 'sequelize-typescript';
import { AttemptResult } from '../enums';
import { WebhookEvent } from './webhook-event.model';

@Table({
  tableName: 'processing_attempts',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['event_uuid', 'attempt_number'],
    },
  ],
})
export class ProcessingAttempt extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => WebhookEvent)
  @Column({ type: DataType.UUID, allowNull: false, field: 'event_uuid' })
  declare eventUuid: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'attempt_number' })
  declare attemptNumber: number;

  @Column({ type: DataType.STRING, allowNull: false, field: 'worker_id' })
  declare workerId: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'started_at' })
  declare startedAt: Date;

  @AllowNull(true)
  @Column({ type: DataType.DATE, field: 'finished_at' })
  declare finishedAt: Date | null;

  @Column({
    type: DataType.ENUM(...Object.values(AttemptResult)),
    allowNull: false,
  })
  declare result: AttemptResult;

  @AllowNull(true)
  @Column({ type: DataType.TEXT })
  declare error: string | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @BelongsTo(() => WebhookEvent, { foreignKey: 'event_uuid', targetKey: 'id' })
  declare event: WebhookEvent;
}
