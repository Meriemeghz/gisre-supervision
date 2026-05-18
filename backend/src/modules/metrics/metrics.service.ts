import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MetricsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getSummary() {
    const result = await this.databaseService.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM api_calls) AS total_api_calls,
        (SELECT COUNT(*)::int FROM api_calls WHERE success = FALSE) AS total_errors,
        (SELECT COALESCE(ROUND(AVG(latency_ms), 2), 0) FROM api_calls) AS avg_latency_ms,
        (SELECT COUNT(*)::int FROM api_calls WHERE is_sla_breach = TRUE) AS sla_breaches,
        (SELECT COUNT(*)::int FROM audit_events WHERE outcome = 'denied') AS total_audit_denied,
        (SELECT COUNT(*)::int FROM api_calls WHERE is_anomaly = TRUE) AS total_simulated_anomalies,
        (SELECT COUNT(*)::int FROM api_calls WHERE analysis_level = 'platform') AS platform_level_events,
        (SELECT COUNT(*)::int FROM api_calls WHERE analysis_level = 'graph') AS graph_level_events
      `,
    );

    return result.rows[0];
  }

  async getByFlow() {
    const result = await this.databaseService.query(
      `
      SELECT
        f.code AS flow_code,
        f.name AS flow_name,
        COUNT(ac.id)::int AS count,
        COALESCE(ROUND(AVG(ac.latency_ms), 2), 0) AS avg_latency_ms,
        COUNT(*) FILTER (WHERE ac.success = FALSE)::int AS error_count,
        COUNT(*) FILTER (WHERE ac.is_sla_breach = TRUE)::int AS sla_breach_count,
        COUNT(*) FILTER (WHERE ac.is_anomaly = TRUE)::int AS anomaly_count,
        MAX(ac.flow_criticality) AS flow_criticality
      FROM flows f
      LEFT JOIN api_calls ac ON ac.flow_id = f.id
      GROUP BY f.id, f.code, f.name
      ORDER BY f.code
      `,
    );

    return result.rows;
  }
}
