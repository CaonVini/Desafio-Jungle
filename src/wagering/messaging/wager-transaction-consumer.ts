import { Injectable, Logger } from "@nestjs/common";
import { InboxRepository } from "../../inbox/domain/inbox.repository";
import { MetricsService } from "../../metrics/metrics.service";
import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { asObject, readString } from "../../shared/http/payload-parser";
import { runWithCorrelationId } from "../../shared/logging/correlation";
import {
  ProcessWagerTransactionInput,
  ProcessWagerTransactionUseCase,
} from "../application/process-wager-transaction.use-case";
import { logTransaction } from "../application/transaction-log";
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
  correlationId: string;
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
    private readonly metrics: MetricsService,
  ) {}

  async consume(body: string): Promise<ConsumeOutcome> {
    const message = parseMessage(body);
    const { messageId, input } = message;
    const context = {
      messageId,
      walletId: input.walletId,
      providerId: input.providerId,
    };

    return runWithCorrelationId(message.correlationId, async () => {
      const startedAt = performance.now();
      try {
        const { outcome, result } = await this.transactions.run(async (tx) => {
          const isNew = await this.inbox.registerIfAbsent(tx, {
            consumerName: CONSUMER_NAME,
            messageId,
            messageType: message.type,
            receivedAt: new Date(),
          });
          if (!isNew) {
            return { outcome: "DUPLICATE" as const, result: undefined };
          }
          const result = await this.processTransaction.executeWithin(tx, input);
          return { outcome: "PROCESSED" as const, result };
        });

        if (result) {
          this.metrics.recordResult(
            result.transaction.status,
            result.idempotentReplay,
            performance.now() - startedAt,
          );
          logTransaction(this.logger, result.transaction, {
            ...context,
            source: "sqs",
            idempotentReplay: result.idempotentReplay,
          });
        } else {
          this.metrics.duplicateDetected();
          this.logger.log({ message: "message.duplicate", ...context });
        }
        return outcome;
      } catch (error) {
        if (error instanceof DomainError && error.code !== "WALLET_CONCURRENT_UPDATE") {
          this.logger.warn({ message: "message.business_error", code: error.code, ...context });
          return "BUSINESS_ERROR";
        }
        this.logger.warn({
          message: "message.failed",
          error: error instanceof Error ? error.message : String(error),
          ...context,
        });
        throw error;
      }
    });
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

    const correlationId =
      typeof envelope["correlationId"] === "string" && envelope["correlationId"].length <= 128
        ? envelope["correlationId"]
        : messageId;

    const data = asObject(envelope["data"], "data");
    const idempotencyKey =
      typeof data["idempotencyKey"] === "string"
        ? data["idempotencyKey"]
        : `${String(data["providerId"])}:${String(data["externalTransactionId"])}`;
    const input = parseWagerInput(data, idempotencyKey);
    Money.from(input.money);

    return { messageId, correlationId, type, input };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DomainError) {
      throw new PermanentMessageError(error.message);
    }
    throw error;
  }
}
