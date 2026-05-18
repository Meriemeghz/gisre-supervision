import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface ApiCallFilters {
  flowCode?: string;
  statusCode?: string;
  success?: string;
  analysisLevel?: string;
  anomalyFamily?: string;
  anomalyType?: string;
  simulationMode?: string;
  flowCriticality?: string;
  producerCriticality?: string;
  apiCriticality?: string;
  limit?: string;
}

interface AuditEventFilters {
  outcome?: string;
  action?: string;
  limit?: string;
}

@Injectable()
export class EventsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getApiCalls(filters: ApiCallFilters) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.flowCode) {
      params.push(filters.flowCode);
      where.push(`f.code = $${params.length}`);
    }

    if (filters.statusCode) {
      params.push(Number(filters.statusCode));
      where.push(`ac.status_code = $${params.length}`);
    }

    if (filters.success !== undefined) {
      params.push(filters.success === 'true');
      where.push(`ac.success = $${params.length}`);
    }

    if (filters.analysisLevel) {
      params.push(filters.analysisLevel);
      where.push(`ac.analysis_level = $${params.length}`);
    }

    if (filters.anomalyFamily) {
      params.push(filters.anomalyFamily);
      where.push(`ac.anomaly_family = $${params.length}`);
    }

    if (filters.anomalyType) {
      params.push(filters.anomalyType);
      where.push(`ac.anomaly_type = $${params.length}`);
    }

    if (filters.simulationMode) {
      params.push(filters.simulationMode);
      where.push(`ac.simulation_mode = $${params.length}`);
    }

    if (filters.flowCriticality) {
      params.push(filters.flowCriticality);
      where.push(`ac.flow_criticality = $${params.length}`);
    }

    if (filters.producerCriticality) {
      params.push(filters.producerCriticality);
      where.push(`ac.producer_criticality = $${params.length}`);
    }

    if (filters.apiCriticality) {
      params.push(filters.apiCriticality);
      where.push(`ac.api_criticality = $${params.length}`);
    }

    params.push(this.parseLimit(filters.limit));
    const limitIndex = params.length;

    const result = await this.databaseService.query(
      `
      SELECT
        ac.*,
        COALESCE(ac.flow_code, f.code) AS flow_code,
        COALESCE(ac.api_code, a.code) AS api_code,
        COALESCE(ac.consumer_code, consumer.code) AS consumer_code,
        COALESCE(ac.producer_code, producer.code) AS producer_code
      FROM api_calls ac
      JOIN flows f ON f.id = ac.flow_id
      JOIN apis a ON a.id = ac.api_id
      JOIN actors consumer ON consumer.id = ac.consumer_actor_id
      JOIN actors producer ON producer.id = ac.producer_actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ac.called_at DESC
      LIMIT $${limitIndex}
      `,
      params,
    );

    return result.rows;
  }

  async getAuditEvents(filters: AuditEventFilters) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.outcome) {
      params.push(filters.outcome);
      where.push(`ae.outcome = $${params.length}`);
    }

    if (filters.action) {
      params.push(filters.action);
      where.push(`ae.action = $${params.length}`);
    }

    params.push(this.parseLimit(filters.limit));
    const limitIndex = params.length;

    const result = await this.databaseService.query(
      `
      SELECT
        ae.*,
        f.code AS flow_code,
        a.code AS api_code,
        actor.code AS actor_code,
        ae.technical_context->>'analysis_level' AS analysis_level,
        ae.technical_context->>'anomaly_family' AS anomaly_family,
        ae.technical_context->>'anomaly_type' AS anomaly_type,
        ae.technical_context->>'anomaly_scope' AS anomaly_scope,
        ae.technical_context->>'anomaly_correlation_id' AS anomaly_correlation_id,
        ae.technical_context->>'scenario_id' AS scenario_id,
        ae.technical_context->>'simulation_mode' AS simulation_mode,
        ae.technical_context->>'program_code' AS program_code,
        ae.technical_context->>'api_code' AS payload_api_code,
        ae.technical_context->>'consumer_code' AS consumer_code,
        ae.technical_context->>'producer_code' AS producer_code
      FROM audit_events ae
      LEFT JOIN flows f ON f.id = ae.flow_id
      LEFT JOIN apis a ON a.id = ae.api_id
      LEFT JOIN actors actor ON actor.id = ae.actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ae.event_timestamp DESC
      LIMIT $${limitIndex}
      `,
      params,
    );

    return result.rows;
  }

  private parseLimit(limit?: string): number {
    const value = limit ? Number(limit) : 100;
    if (!Number.isFinite(value) || value <= 0) {
      return 100;
    }

    return Math.min(value, 500);
  }
}
