import { INestApplication } from "@nestjs/common";
import { AllExceptionsFilter } from "./shared/http/all-exceptions.filter";
import { CorrelationIdInterceptor } from "./shared/http/correlation-id.interceptor";

export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
}
