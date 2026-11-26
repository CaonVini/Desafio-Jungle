import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import { runWithCorrelationId } from "../logging/correlation";

export const CORRELATION_ID_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID = /^[\w.:-]{1,128}$/;

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const received = http.getRequest<Request>().headers[CORRELATION_ID_HEADER];
    const correlationId =
      typeof received === "string" && VALID_CORRELATION_ID.test(received) ? received : uuidv7();
    http.getResponse<Response>().setHeader(CORRELATION_ID_HEADER, correlationId);

    return new Observable((subscriber) =>
      runWithCorrelationId(correlationId, () => next.handle().subscribe(subscriber)),
    );
  }
}
