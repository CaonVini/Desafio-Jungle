import { Module } from "@nestjs/common";
import { OutboxPublisherService } from "./application/outbox-publisher.service";
import { MessagePublisher } from "./domain/message-publisher";
import { OutboxRepository } from "./domain/outbox.repository";
import { SqsMessagePublisher } from "./infra/sqs-message-publisher";
import { TypeOrmOutboxRepository } from "./infra/typeorm-outbox.repository";

@Module({
  providers: [
    OutboxPublisherService,
    { provide: OutboxRepository, useClass: TypeOrmOutboxRepository },
    { provide: MessagePublisher, useClass: SqsMessagePublisher },
  ],
  exports: [OutboxPublisherService, OutboxRepository],
})
export class OutboxModule {}
