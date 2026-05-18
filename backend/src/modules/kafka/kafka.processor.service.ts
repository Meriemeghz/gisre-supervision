import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ApiCallKafkaEvent, AuditKafkaEvent } from './kafka.types';

@Injectable()
export class KafkaProcessorService {
  private readonly logger = new Logger(KafkaProcessorService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async handleApiCallEvent(payload: unknown): Promise<void> {
    const event = payload as ApiCallKafkaEvent;
    if (!this.isValidApiCallEvent(event)) {
      this.logger.warn('[KAFKA] invalid api_call event ignored');
      return;
    }

    await this.databaseService.query(
      `
      INSERT INTO api_calls (
        flow_id,
        api_id,
        consumer_actor_id,
        producer_actor_id,
        correlation_id,
        endpoint_path,
        method,
        status_code,
        latency_ms,
        success,
        error_type,
        called_at,
        source_ip,
        gateway_node,
        is_sla_breach,
        error_code,
        flow_code,
        api_code,
        consumer_code,
        producer_code,
        program_code,
        sla_latency_ms,
        expected_calls_per_minute,
        api_criticality,
        consumer_criticality,
        producer_criticality,
        flow_criticality,
        is_anomaly,
        anomaly_type,
        anomaly_family,
        analysis_level,
        anomaly_scope,
        anomaly_correlation_id,
        scenario_id,
        simulation_mode,
        event_sequence_number,
        ingestion_delay_ms,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30, $31, $32,
        $33, $34, $35, $36, $37, $38::jsonb
      )
      `,
      [
        event.flow_id,
        event.api_id,
        event.consumer_actor_id,
        event.producer_actor_id,
        event.correlation_id,
        event.endpoint_path,
        event.method ?? 'GET',
        event.status_code,
        event.latency_ms,
        event.success,
        event.error_type ?? null,
        event.timestamp ?? new Date().toISOString(),
        event.source_ip ?? null,
        event.gateway_node ?? null,
        Boolean(event.is_sla_breach),
        event.error_code ?? null,
        event.flow_code ?? null,
        event.api_code ?? null,
        event.consumer_code ?? null,
        event.producer_code ?? null,
        event.program_code ?? null,
        event.sla_latency_ms ?? null,
        event.expected_calls_per_minute ?? null,
        event.api_criticality ?? null,
        event.consumer_criticality ?? null,
        event.producer_criticality ?? null,
        event.flow_criticality ?? null,
        event.is_anomaly ?? false,
        event.anomaly_type ?? event.injected_anomaly_type ?? null,
        event.anomaly_family ?? null,
        event.analysis_level ?? null,
        event.anomaly_scope ?? null,
        event.anomaly_correlation_id ?? null,
        event.scenario_id ?? null,
        event.simulation_mode ?? (event.scenario_type === 'anomalous' ? 'incident' : 'normal'),
        event.event_sequence_number ?? null,
        event.ingestion_delay_ms ?? 0,
        JSON.stringify(event.metadata ?? {}),
      ],
    );

    this.logger.log(`[POSTGRES] api_call stored correlation=${event.correlation_id}`);
  }

  async handleAuditEvent(payload: unknown): Promise<void> {
    const event = payload as AuditKafkaEvent;
    if (!this.isValidAuditEvent(event)) {
      this.logger.warn('[KAFKA] invalid audit_event ignored');
      return;
    }

    const technicalContext = {
      scenario_type: event.scenario_type ?? null,
      injected_anomaly_type: event.injected_anomaly_type ?? null,
      rule_code: event.rule_code ?? null,
      rule_description: event.rule_description ?? null,
      simulation_source: event.simulation_source ?? null,
      is_anomaly: event.is_anomaly ?? false,
      anomaly_type: event.anomaly_type ?? event.injected_anomaly_type ?? null,
      anomaly_family: event.anomaly_family ?? null,
      analysis_level: event.analysis_level ?? null,
      anomaly_scope: event.anomaly_scope ?? null,
      anomaly_correlation_id: event.anomaly_correlation_id ?? null,
      scenario_id: event.scenario_id ?? null,
      simulation_mode: event.simulation_mode ?? null,
      program_code: event.program_code ?? null,
      flow_code: event.flow_code ?? null,
      api_code: event.api_code ?? null,
      consumer_code: event.consumer_code ?? null,
      producer_code: event.producer_code ?? null,
      api_criticality: event.api_criticality ?? null,
      consumer_criticality: event.consumer_criticality ?? null,
      producer_criticality: event.producer_criticality ?? null,
      flow_criticality: event.flow_criticality ?? null,
      event_sequence_number: event.event_sequence_number ?? null,
      ingestion_delay_ms: event.ingestion_delay_ms ?? null,
      metadata: event.metadata ?? {},
      payload: event,
    };

    await this.databaseService.query(
      `
      INSERT INTO audit_events (
        actor_id,
        api_id,
        flow_id,
        correlation_id,
        event_type,
        action,
        outcome,
        event_timestamp,
        source_ip,
        technical_context
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      `,
      [
        event.actor_id,
        event.api_id,
        event.flow_id,
        event.correlation_id,
        event.event_type,
        event.action ?? 'call_api',
        event.outcome,
        event.timestamp ?? new Date().toISOString(),
        event.source_ip ?? null,
        JSON.stringify(technicalContext),
      ],
    );

    this.logger.log(`[POSTGRES] audit_event stored correlation=${event.correlation_id}`);
  }

  private isValidApiCallEvent(event: ApiCallKafkaEvent): boolean {
    return Boolean(
      event &&
        event.event_type === 'api_call' &&
        event.flow_id &&
        event.api_id &&
        event.consumer_actor_id &&
        event.producer_actor_id &&
        event.correlation_id &&
        event.endpoint_path &&
        event.status_code &&
        event.latency_ms !== undefined &&
        event.success !== undefined,
    );
  }

  private isValidAuditEvent(event: AuditKafkaEvent): boolean {
    return Boolean(
      event &&
        event.event_type === 'audit_event' &&
        event.actor_id &&
        event.api_id &&
        event.flow_id &&
        event.correlation_id &&
        event.outcome,
    );
  }
}
