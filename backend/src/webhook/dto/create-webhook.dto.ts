import { IsNotEmpty, IsString, IsObject } from 'class-validator';

export class CreateWebhookDto {
  @IsNotEmpty()
  @IsString()
  eventId!: string;

  @IsNotEmpty()
  @IsString()
  type!: string;

  @IsNotEmpty()
  @IsObject()
  data!: Record<string, any>;
}
