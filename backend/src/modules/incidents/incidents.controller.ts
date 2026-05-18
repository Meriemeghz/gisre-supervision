import { Controller, Get, Query } from '@nestjs/common';
import { IncidentsService } from './incidents.service';

@Controller()
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get('incidents')
  getIncidents(@Query('limit') limit?: string) {
    return this.incidentsService.getIncidents(limit);
  }

  @Get('anomalies')
  getAnomalies(@Query('limit') limit?: string) {
    return this.incidentsService.getAnomalies(limit);
  }
}
