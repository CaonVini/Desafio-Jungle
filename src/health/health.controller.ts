import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../shared/http/auth.guard";
import { HealthService, ReadinessReport } from "./health.service";

@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== "ok") {
      response.status(503);
    }
    return report;
  }
}
