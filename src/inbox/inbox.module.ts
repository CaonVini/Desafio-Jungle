import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InboxConsumerService } from "./application/inbox-consumer.service";
import { EventHandler } from "./domain/event-handler";
import { InboxRepository } from "./domain/inbox.repository";
import { InboxMessageOrmEntity } from "./infra/inbox-message.orm-entity";
import { LoggingEventHandler } from "./infra/logging-event-handler";
import { TypeOrmInboxRepository } from "./infra/typeorm-inbox.repository";

@Module({
  imports: [TypeOrmModule.forFeature([InboxMessageOrmEntity])],
  providers: [
    InboxConsumerService,
    { provide: InboxRepository, useClass: TypeOrmInboxRepository },
    { provide: EventHandler, useClass: LoggingEventHandler },
  ],
  exports: [InboxConsumerService],
})
export class InboxModule {}