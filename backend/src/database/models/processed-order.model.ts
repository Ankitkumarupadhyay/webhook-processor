import {
  Table,
  Column,
  Model,
  DataType,
  Default,
  AllowNull,
  Unique,
  CreatedAt,
} from 'sequelize-typescript';

/**
 * ProcessedOrder — the actual business result of processing a webhook.
 *
 * CRITICAL: eventId has a UNIQUE constraint enforced at the database level.
 * This is the final line of defence against duplicate business processing.
 * Even if multiple workers attempt to insert, only one will succeed.
 */
@Table({
  tableName: 'processed_orders',
  timestamps: false,
})
export class ProcessedOrder extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'order_id' })
  declare orderId: string;

  /**
   * eventId UNIQUE — PostgreSQL enforces exactly-once business processing.
   */
  @Unique
  @Column({ type: DataType.STRING, allowNull: false, field: 'event_id' })
  declare eventId: string;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'processed_at' })
  declare processedAt: Date;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
