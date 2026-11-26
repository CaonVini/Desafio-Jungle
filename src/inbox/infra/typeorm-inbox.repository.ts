import { Injectable } from "@nestjs/common";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { asManager } from "../../shared/infra/database/typeorm-helpers";
import { InboxRepository } from "../domain/inbox.repository";
import { ReceivedEvent } from "../domain/received-event";
import { InboxMessageOrmEntity } from "./inbox-message.orm-entity";

@Injectable()
export class TypeOrmInboxRepository extends InboxRepository {
  async registerIfAbsent(
    tx: TransactionContext,
    event: ReceivedEvent,
    processedAt: Date,
  ): Promise<boolean> {
    const result = await asManager(tx)
      .createQueryBuilder()
      .insert()
      .into(InboxMessageOrmEntity)
      .values({ messageId: event.id, eventType: event.type, processedAt })
      .orIgnore()
      .returning("message_id")
      .execute();
    return result.raw.length > 0;
  }
}