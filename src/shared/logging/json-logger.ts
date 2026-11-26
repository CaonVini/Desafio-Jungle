import { LoggerService } from "@nestjs/common";
import { currentCorrelationId } from "./correlation";

type Level = "debug" | "info" | "warn" | "error";

export class JsonLogger implements LoggerService {
  constructor(private readonly output: (line: string) => void = writeToStdout) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write("info", message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write("warn", message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write("error", message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write("debug", message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write("debug", message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write("error", message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    const context = typeof params.at(-1) === "string" ? (params.at(-1) as string) : undefined;
    const stack = level === "error" && params.length > 1 ? params[0] : undefined;

    const fields = toFields(message);

    this.output(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        context,
        correlationId: currentCorrelationId(),
        ...fields,
        stack: typeof stack === "string" ? stack : undefined,
      }),
    );
  }
}

function toFields(message: unknown): object {
  if (message instanceof Error) {
    return { message: message.message, errorName: message.name, errorStack: message.stack };
  }
  if (message !== null && typeof message === "object") {
    return { ...(message as object) };
  }
  return { message };
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}
