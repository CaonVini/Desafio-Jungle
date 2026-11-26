import { Injectable, Logger } from "@nestjs/common";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { EventHandler } from "../domain/event-handler";
import { ReceivedEvent } from "../domain/received-event";

@Injectable()
export class LoggingEventHandler extends EventHandler {
  private readonly logger = new Logger(LoggingEventHandler.name);

  async handle(_tx: TransactionContext, event: ReceivedEvent): Promise<void> {
    this.logger.log(`Evento ${event.type} recebido (${event.id})`);
  }
}