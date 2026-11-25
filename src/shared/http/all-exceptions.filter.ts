import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { Response } from "express";
import { DomainError } from "../domain/domain-error";

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_PAYLOAD: 400,
  INVALID_AMOUNT: 400,
  INVALID_CURRENCY: 400,
  REFERENCE_REQUIRED: 400,
  WALLET_NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  WALLET_ALREADY_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  WALLET_CONCURRENT_UPDATE: 503,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = STATUS_BY_CODE[exception.code] ?? 422;
      response.status(status).json({ code: exception.code, message: exception.message });
      return;
    }

    if (exception instanceof HttpException) {
      response
        .status(exception.getStatus())
        .json({ code: "HTTP_ERROR", message: exception.message });
      return;
    }

    this.logger.error(
      "Unhandled error",
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(500).json({ code: "INTERNAL_ERROR", message: "Internal server error" });
  }
}