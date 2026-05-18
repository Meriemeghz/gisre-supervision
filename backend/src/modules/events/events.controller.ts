import { Controller, Get, Query } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('api-calls')
  getApiCalls(
    @Query('flowCode') flowCode?: string,
    @Query('statusCode') statusCode?: string,
    @Query('success') success?: string,
    @Query('analysisLevel') analysisLevel?: string,
    @Query('anomalyFamily') anomalyFamily?: string,
    @Query('anomalyType') anomalyType?: string,
    @Query('simulationMode') simulationMode?: string,
    @Query('flowCriticality') flowCriticality?: string,
    @Query('producerCriticality') producerCriticality?: string,
    @Query('apiCriticality') apiCriticality?: string,
    @Query('limit') limit?: string,
  ) {
    return this.eventsService.getApiCalls({
      flowCode,
      statusCode,
      success,
      analysisLevel,
      anomalyFamily,
      anomalyType,
      simulationMode,
      flowCriticality,
      producerCriticality,
      apiCriticality,
      limit,
    });
  }

  @Get('audit-events')
  getAuditEvents(
    @Query('outcome') outcome?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    return this.eventsService.getAuditEvents({ outcome, action, limit });
  }
}
