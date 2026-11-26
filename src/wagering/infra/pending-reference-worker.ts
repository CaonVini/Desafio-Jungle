import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { PendingReferenceService } from "../application/pending-reference.service";

@Injectable()
export class PendingReferenceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private readonly intervalMs = Number(process.env.PENDING_REFERENCE_POLL_INTERVAL_MS ?? 5000);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly service: PendingReferenceService) {}

  onApplicationBootstrap(): void {
    if (process.env.PENDING_REFERENCE_WORKER_ENABLED === "false") {
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
      await this.service.retryDue();
    } catch (error) {
      this.logger.error({
        message: "pending_reference.worker_cycle_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.schedule();
  }
}
