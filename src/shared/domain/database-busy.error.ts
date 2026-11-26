export class DatabaseBusyError extends Error {
  readonly code = "DATABASE_BUSY";

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DatabaseBusyError";
  }
}
