import { Injectable, Logger } from "@nestjs/common";
import { InboxRepository } from "../../inbox/domain/inbox.repository";
import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { asObject, readString } from "../../shared/http/payload-parser";
import {
  ProcessWagerTransactionInput,
  ProcessWagerTransactionUseCase,
} from "../application/process-wager-transaction.use-case";
import { parseWagerInput } from "../application/wager-input.parser";

export const CONSUMER_NAME = "wager-transactions";
export const MESSAGE_TYPE = "WagerTransactionRequested";

export type ConsumeOutcome = "PROCESSED" | "DUPLICATE" | "BUSINESS_ERROR";

export class PermanentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMessageError";
  }
}

interface ParsedMessage {
  messageId: string;
  type: string;
  input: ProcessWagerTransactionInput;
}

@Injectable()
export class WagerTransactionConsumer {
  private readonly logger = new Logger(WagerTransactionConsumer.name);

  constructor(
    private readonly transactions: TransactionManager,
    private readonly inbox: InboxRepository,
    private readonly processTransaction: ProcessWagerTransactionUseCase,
  ) {}

  async consume(body: string): Promise<ConsumeOutcome> {
    const message = parseMessage(body);

    try {
      return await this.transactions.run(async (tx) => {
        const isNew = await this.inbox.registerIfAbsent(tx, {
          consumerName: CONSUMER_NAME,
          messageId: message.messageId,
          messageType: message.type,
          receivedAt: new Date(),
        });
        if (!isNew) {
          return "DUPLICATE";
        }
        await this.processTransaction.executeWithin(tx, message.input);
        return "PROCESSED";
      });
    } catch (error) {
      if (error instanceof DomainError) {
        this.logger.warn(
          `Mensagem ${message.messageId} rejeitada por regra de negocio: ${error.code}`,
        );
        return "BUSINESS_ERROR";
      }
      throw error;
    }
  }
}

function parseMessage(body: string): ParsedMessage {
  try {
    const envelope = asObject(JSON.parse(body), "message");
    const messageId = readString(envelope, "messageId", 128);
    const type = readString(envelope, "type", 64);
    if (type !== MESSAGE_TYPE) {
      throw new DomainError(`unsupported message type: ${type}`, "INVALID_PAYLOAD");
    }
    if (Number.isNaN(Date.parse(readString(envelope, "occurredAt", 64)))) {
      throw new DomainError("occurredAt must be an ISO date", "INVALID_PAYLOAD");
    }

    const data = asObject(envelope["data"], "data");
    const idempotencyKey =
      typeof data["idempotencyKey"] === "string"
        ? data["idempotencyKey"]
        : `${String(data["providerId"])}:${String(data["externalTransactionId"])}`;
    const input = parseWagerInput(data, idempotencyKey);
    Money.from(input.money);

    return { messageId, type, input };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DomainError) {
      throw new PermanentMessageError(error.message);
    }
    throw error;
  }
}
