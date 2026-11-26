import { describe, expect, it } from "bun:test";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { HealthController } from "../../health/health.controller";
import { AuthGuard, IS_PUBLIC, Public } from "./auth.guard";

function contextFor(handler: () => unknown, controller: new (...args: never[]) => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  const guard = new AuthGuard(new Reflector());

  class SampleController {
    @Public()
    open(): void {}

    closed(): void {}
  }

  it("rota publica passa sem autenticar", () => {
    const sample = new SampleController();
    expect(guard.canActivate(contextFor(sample.open.bind(sample), SampleController))).toBe(true);
  });

  it("sem IdP configurado, as demais rotas tambem passam (ponto de extensao vazio)", () => {
    const sample = new SampleController();
    expect(guard.canActivate(contextFor(sample.closed.bind(sample), SampleController))).toBe(true);
  });

  it("os endpoints de health estao marcados como publicos", () => {
    expect(Reflect.getMetadata(IS_PUBLIC, HealthController)).toBe(true);
  });
});
