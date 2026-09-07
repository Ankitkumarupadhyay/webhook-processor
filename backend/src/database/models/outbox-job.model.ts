import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  AllowNull,
  CreatedAt,
} from 'sequelize-typescript';
import { OutboxJobStatus } from '../enums';

@Table({
  tableName: 'outbox_jobs',
  timestamps: false,
})
export class OutboxJob extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'event_id' })
  declare eventId: string;

  @Default('process-webhook')
  @Column({ type: DataType.STRING, allowNull: false, field: 'job_type' })
  declare jobType: string;

  @Default(OutboxJobStatus.PENDING)
  @Column({
    type: DataType.ENUM(...Object.values(OutboxJobStatus)),
    allowNull: false,
  })
  declare status: OutboxJobStatus;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ type: DataType.DATE, field: 'processed_at' })
  declare processedAt: Date | null;
}
