import { Module } from '@nestjs/common';
import { KafkaConsumerService } from './kafka.consumer.service';
import { KafkaProcessorService } from './kafka.processor.service';

@Module({
  providers: [KafkaConsumerService, KafkaProcessorService],
})
export class KafkaModule {}
