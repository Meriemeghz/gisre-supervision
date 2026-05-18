import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    this.pool = new Pool({
      host: this.configService.get<string>('POSTGRES_HOST', 'postgres'),
      port: Number(this.configService.get<string>('POSTGRES_PORT', '5432')),
      database: this.configService.get<string>('POSTGRES_DB', 'gisre_db'),
      user: this.configService.get<string>('POSTGRES_USER', 'admin'),
      password: this.configService.get<string>('POSTGRES_PASSWORD', 'admin'),
      max: 10,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.waitForPostgres();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('[POSTGRES] pool closed');
  }

  private async waitForPostgres(maxRetries = 30, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        await this.pool.query('SELECT 1');
        this.logger.log('[POSTGRES] connected');
        return;
      } catch (error) {
        this.logger.warn(
          `[POSTGRES] waiting (${attempt}/${maxRetries}) - ${this.formatError(error)}`,
        );
        await this.sleep(delayMs);
      }
    }

    throw new Error('PostgreSQL is not reachable');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
