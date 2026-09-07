import { Controller, Get, Post, Param, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  async listEvents(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return await this.eventsService.listEvents(page, limit);
  }

  @Get(':eventId')
  async getEventDetails(@Param('eventId') eventId: string) {
    return await this.eventsService.getEventDetails(eventId);
  }

  @Post(':eventId/retry')
  async manualRetry(@Param('eventId') eventId: string) {
    return await this.eventsService.manualRetry(eventId);
  }
}
