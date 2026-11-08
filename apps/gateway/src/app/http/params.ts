import { HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { apiError } from './api-error';

/**
 * A UUID path parameter. Anything else is `400 VALIDATION_FAILED`, like an
 * invalid body field, naming the parameter but never echoing its value.
 * (Nest's own message would be answered as `MALFORMED_REQUEST`.)
 */
export const UuidParam = (name: string): ParameterDecorator =>
  Param(
    name,
    new ParseUUIDPipe({
      exceptionFactory: () =>
        apiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          `Invalid fields: ${name}`,
        ),
    }),
  );
