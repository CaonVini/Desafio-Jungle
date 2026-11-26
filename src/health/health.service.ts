import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { DataSource } from "typeorm";

const CHECK_TIMEOUT_MS = 3_000;

type CheckStatus = "up" | "down";

export interface ReadinessReport {
  status: "ok" | "unavailable";
  checks: { postgres: CheckStatus; sqs: CheckStatus };
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private sqs: SQSClient | undefined;

  constructor(private readonly dataSource: DataSource) {}

  async readiness(): Promise<ReadinessReport> {
    const [postgres, sqs] = await Promise.all([this.checkPostgres(), this.checkSqs()]);
    return {
      status: postgres === "up" && sqs === "up" ? "ok" : "unavailable",
      checks: { postgres, sqs },
    };
  }

  onModuleDestroy(): void {
    this.sqs?.destroy();
  }

  private async checkPostgres(): Promise<CheckStatus> {
    try {
      await withTimeout(this.dataSource.query("SELECT 1"), CHECK_TIMEOUT_MS);
      return "up";
    } catch (error) {
      this.logFailure("postgres", error);
      return "down";
    }
  }

  private async checkSqs(): Promise<CheckStatus> {
    const queueUrl = process.env.SQS_TRANSACTIONS_QUEUE_URL;
    if (!queueUrl) {
      this.logFailure("sqs", new Error("SQS_TRANSACTIONS_QUEUE_URL is not set"));
      return "down";
    }

    this.sqs ??= new SQSClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint: process.env.SQS_ENDPOINT || undefined,
    });

    try {
      await this.sqs.send(
        new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] }),
        { abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
      );
      return "up";
    } catch (error) {
      this.logFailure("sqs", error);
      return "down";
    }
  }

  private logFailure(check: string, error: unknown): void {
    this.logger.warn({
      message: "health.check_failed",
      check,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
