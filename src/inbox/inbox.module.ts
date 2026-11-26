import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InboxRepository } from "./domain/inbox.repository";
import { InboxMessageOrmEntity } from "./infra/inbox-message.orm-entity";
import { TypeOrmInboxRepository } from "./infra/typeorm-inbox.repository";

@Module({
  imports: [TypeOrmModule.forFeature([InboxMessageOrmEntity])],
  providers: [{ provide: InboxRepository, useClass: TypeOrmInboxRepository }],
  exports: [InboxRepository],
})
export class InboxModule {}
