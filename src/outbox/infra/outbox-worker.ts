import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { OutboxPublisherService } from "../application/outbox-publisher.service";

@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly service: OutboxPublisherService) {}

  onApplicationBootstrap(): void {
    if (process.env.OUTBOX_WORKER_ENABLED === "false") {
      return;
    }
    this.schedule();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.service.publishBatch();
    } catch (error) {
      this.logger.error(`Erro no ciclo do outbox: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.schedule();
  }
}