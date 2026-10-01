import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthResponse } from './api.dto';

/** Liveness for the reverse proxy / orchestrator. Does not call services. */
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ type: HealthResponse })
  get(): HealthResponse {
    return { status: 'ok' };
  }
}
