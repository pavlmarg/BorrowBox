import { HttpException, type HttpStatus } from '@nestjs/common';

/** Body of every error response: `{ statusCode, code, message }`. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

export function apiError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  const body: ApiErrorBody = { statusCode: status, code, message };
  return new HttpException(body, status);
}
