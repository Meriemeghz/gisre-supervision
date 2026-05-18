import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class IncidentsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getIncidents(limit?: string) {
    const result = await this.databaseService.query(
      `
      SELECT
        ie.*,
        f.code AS flow_code,
        a.code AS api_code
      FROM incident_events ie
      LEFT JOIN flows f ON f.id = ie.flow_id
      LEFT JOIN apis a ON a.id = ie.api_id
      ORDER BY ie.detected_at DESC
      LIMIT $1
      `,
      [this.parseLimit(limit)],
    );

    return result.rows;
  }

  async getAnomalies(limit?: string) {
    const result = await this.databaseService.query(
      `
      SELECT *
      FROM (
        SELECT
          'api_call' AS source,
          ac.id,
          ac.flow_id,
          COALESCE(ac.flow_code, f.code) AS flow_code,
          ac.api_id,
          COALESCE(ac.api_code, a.code) AS api_code,
          ac.correlation_id,
          ac.called_at AS event_timestamp,
          COALESCE(ac.anomaly_type, CASE
            WHEN ac.success = FALSE THEN 'api_error'
            WHEN ac.is_sla_breach = TRUE THEN 'sla_breach'
            ELSE 'api_signal'
          END) AS anomaly_type,
          jsonb_build_object(
            'status_code', ac.status_code,
            'latency_ms', ac.latency_ms,
            'success', ac.success,
            'error_type', ac.error_type,
            'is_sla_breach', ac.is_sla_breach,
            'is_anomaly', ac.is_anomaly,
            'anomaly_family', ac.anomaly_family,
            'analysis_level', ac.analysis_level,
            'anomaly_scope', ac.anomaly_scope,
            'anomaly_correlation_id', ac.anomaly_correlation_id,
            'scenario_id', ac.scenario_id,
            'simulation_mode', ac.simulation_mode,
            'flow_criticality', ac.flow_criticality,
            'api_criticality', ac.api_criticality,
            'producer_criticality', ac.producer_criticality,
            'metadata', ac.metadata
          ) AS details
        FROM api_calls ac
        JOIN flows f ON f.id = ac.flow_id
        JOIN apis a ON a.id = ac.api_id
        WHERE ac.success = FALSE OR ac.is_sla_breach = TRUE OR ac.is_anomaly = TRUE

        UNION ALL

        SELECT
          'audit_event' AS source,
          ae.id,
          ae.flow_id,
          f.code AS flow_code,
          ae.api_id,
          a.code AS api_code,
          ae.correlation_id,
          ae.event_timestamp,
          'audit_' || ae.outcome AS anomaly_type,
          jsonb_build_object(
            'action', ae.action,
            'outcome', ae.outcome,
            'source_ip', ae.source_ip,
            'technical_context', ae.technical_context
          ) AS details
        FROM audit_events ae
        LEFT JOIN flows f ON f.id = ae.flow_id
        LEFT JOIN apis a ON a.id = ae.api_id
        WHERE ae.outcome IN ('denied', 'failure')
      ) anomalies
      ORDER BY event_timestamp DESC
      LIMIT $1
      `,
      [this.parseLimit(limit)],
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
