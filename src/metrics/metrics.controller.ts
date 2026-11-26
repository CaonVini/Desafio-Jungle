import { Controller, Get, Header } from "@nestjs/common";
import { OutboxRepository } from "../outbox/domain/outbox.repository";
import { Public } from "../shared/http/auth.guard";
import { TransactionManager } from "../shared/domain/transaction-manager";
import { MetricsService } from "./metrics.service";

@Public()
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly transactions: TransactionManager,
    private readonly outbox: OutboxRepository,
  ) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async scrape(): Promise<string> {
    const stats = await this.transactions.run((tx) => this.outbox.pendingStats(tx, new Date()));
    return this.metrics.render(stats);
  }
}
