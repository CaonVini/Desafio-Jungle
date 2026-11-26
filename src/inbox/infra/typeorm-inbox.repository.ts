import { Injectable } from "@nestjs/common";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { asManager } from "../../shared/infra/database/typeorm-helpers";
import { InboxEntry, InboxRepository } from "../domain/inbox.repository";
import { InboxMessageOrmEntity } from "./inbox-message.orm-entity";

@Injectable()
export class TypeOrmInboxRepository extends InboxRepository {
  async registerIfAbsent(tx: TransactionContext, entry: InboxEntry): Promise<boolean> {
    const result = await asManager(tx)
      .createQueryBuilder()
      .insert()
      .into(InboxMessageOrmEntity)
      .values(entry)
      .orIgnore()
      .returning("message_id")
      .execute();
    return result.raw.length > 0;
  }
}
