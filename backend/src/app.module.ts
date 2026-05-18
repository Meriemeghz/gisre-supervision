import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './modules/database/database.module';
import { EventsModule } from './modules/events/events.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { KafkaModule } from './modules/kafka/kafka.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    KafkaModule,
    EventsModule,
    MetricsModule,
    IncidentsModule,
  ],
})
export class AppModule {}
