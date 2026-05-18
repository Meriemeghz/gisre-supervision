import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { KafkaProcessorService } from './kafka.processor.service';
import { KafkaTopic } from './kafka.types';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: KafkaProcessorService,
  ) {
    const brokers = this.configService
      .get<string>('KAFKA_BROKERS', 'kafka:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);

    this.kafka = new Kafka({
      clientId: 'gisre-backend',
      brokers,
      retry: {
        initialRetryTime: 1000,
        retries: 15,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: 'gisre-backend-consumer-group',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    this.logger.log('[KAFKA] connected');

    await this.consumer.subscribe({
      topic: 'gisre.api.calls',
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: 'gisre.audit.events',
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const payload = this.parsePayload(message.value?.toString());
          if (!payload) {
            return;
          }

          this.logger.log(`[KAFKA] received ${topic}`);
          await this.routeMessage(topic as KafkaTopic, payload);
        } catch (error) {
          this.logger.error(
            `[KAFKA] message processing failed: ${this.formatError(error)}`,
          );
        }
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
    this.logger.log('[KAFKA] disconnected');
  }

  private async routeMessage(topic: KafkaTopic, payload: unknown): Promise<void> {
    if (topic === 'gisre.api.calls') {
      await this.processor.handleApiCallEvent(payload);
      return;
    }

    if (topic === 'gisre.audit.events') {
      await this.processor.handleAuditEvent(payload);
    }
  }

  private parsePayload(rawPayload?: string): unknown | null {
    if (!rawPayload) {
      this.logger.warn('[KAFKA] empty message ignored');
      return null;
    }

    try {
      return JSON.parse(rawPayload);
    } catch (error) {
      this.logger.warn(`[KAFKA] invalid JSON ignored: ${this.formatError(error)}`);
      return null;
    }
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
