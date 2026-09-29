import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      void reply
        .status(exception.getStatus())
        .send(
          typeof response === 'string'
            ? { statusCode: exception.getStatus(), message: response }
            : response,
        );
      return;
    }
    this.logger.error('Unhandled request error');
    void reply.status(500).send({ statusCode: 500, message: 'Internal server error' });
  }
}
