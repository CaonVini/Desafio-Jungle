import { describe, expect, it } from "bun:test";
import { runWithCorrelationId } from "./correlation";
import { JsonLogger } from "./json-logger";

function capture(): { logger: JsonLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = new JsonLogger((line) => lines.push(JSON.parse(line)));
  return { logger, lines };
}

describe("JsonLogger", () => {
  it("serializa a mensagem e a stack quando recebe um Error", () => {
    const { logger, lines } = capture();

    logger.error(new Error("SQS_EVENTS_QUEUE_URL is required"), "ExceptionHandler");

    expect(lines[0]).toMatchObject({
      level: "error",
      context: "ExceptionHandler",
      message: "SQS_EVENTS_QUEUE_URL is required",
      errorName: "Error",
    });
    expect(String(lines[0].errorStack)).toContain("SQS_EVENTS_QUEUE_URL");
  });

  it("escreve uma linha JSON com nivel, contexto e os campos do objeto", () => {
    const { logger, lines } = capture();

    logger.log(
      { message: "transaction.processed", transactionId: "t-1", walletId: "w-1", providerId: "p" },
      "WageringController",
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      context: "WageringController",
      message: "transaction.processed",
      transactionId: "t-1",
      walletId: "w-1",
      providerId: "p",
    });
    expect(typeof lines[0].time).toBe("string");
  });

  it("aceita mensagem em texto simples", () => {
    const { logger, lines } = capture();

    logger.warn("algo aconteceu", "Contexto");

    expect(lines[0]).toMatchObject({
      level: "warn",
      context: "Contexto",
      message: "algo aconteceu",
    });
  });

  it("inclui o correlationId do contexto atual e nao inventa um fora dele", () => {
    const { logger, lines } = capture();

    logger.log({ message: "fora" }, "X");
    runWithCorrelationId("corr-123", () => logger.log({ message: "dentro" }, "X"));

    expect(lines[0].correlationId).toBeUndefined();
    expect(lines[1].correlationId).toBe("corr-123");
  });

  it("o correlationId continua valendo depois de um await", async () => {
    const { logger, lines } = capture();

    await runWithCorrelationId("corr-async", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      logger.log({ message: "depois do await" }, "X");
    });

    expect(lines[0].correlationId).toBe("corr-async");
  });

  it("erro leva a stack no campo stack", () => {
    const { logger, lines } = capture();

    logger.error({ message: "unhandled_error" }, "Error: boom\n    at x", "Filter");

    expect(lines[0]).toMatchObject({
      level: "error",
      context: "Filter",
      stack: "Error: boom\n    at x",
    });
  });
});
