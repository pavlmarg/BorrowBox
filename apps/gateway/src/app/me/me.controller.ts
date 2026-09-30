import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '@borrowbox/auth';
import { IdentityRpc } from '@borrowbox/contracts';
import {
  ApiErrorResponse,
  DataExportResponse,
  DeleteAccountBody,
  UpdateProfileBody,
  UserProfileResponse,
} from '../api.dto';
import { clearRefreshCookie } from '../http/cookies';
import { AuthRateLimit } from '../http/rate-limits';
import { AccessToken, CorrelationId } from '../http/request-context';
import { IdentityClient } from '../identity/identity.client';

/**
 * The signed-in user's own account. The gateway checks the JWT; Identity
 * checks it again and identifies the user from it (never from the body).
 */
@ApiTags('me')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly identity: IdentityClient) {}

  @Get()
  @ApiOperation({ summary: 'My profile' })
  @ApiOkResponse({ type: UserProfileResponse })
  get(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<UserProfileResponse> {
    return this.identity.call(
      IdentityRpc.getMe,
      {},
      { accessToken, correlationId },
    );
  }

  @Patch()
  @ApiOperation({ summary: 'Update my display name and/or language' })
  @ApiOkResponse({ type: UserProfileResponse })
  @ApiResponse({
    status: 400,
    type: ApiErrorResponse,
    description: 'VALIDATION_FAILED',
  })
  update(
    @Body() body: UpdateProfileBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<UserProfileResponse> {
    return this.identity.call(IdentityRpc.updateMe, body, {
      accessToken,
      correlationId,
    });
  }

  @Get('export')
  @Header(
    'Content-Disposition',
    'attachment; filename="borrowbox-data-export.json"',
  )
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download all my personal data (GDPR Art. 15/20)' })
  @ApiOkResponse({ type: DataExportResponse })
  async export(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<DataExportResponse> {
    return {
      identity: await this.identity.call(
        IdentityRpc.exportMe,
        {},
        { accessToken, correlationId },
      ),
    };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  // Checks the password, so it gets the same limit as login.
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Delete my account (GDPR Art. 17)',
    description:
      'Accounts with a password must send it. Accounts without one must have signed in within the last 5 minutes.',
  })
  @ApiNoContentResponse()
  @ApiResponse({
    status: 401,
    type: ApiErrorResponse,
    description: 'INVALID_CREDENTIALS (wrong password)',
  })
  @ApiResponse({
    status: 403,
    type: ApiErrorResponse,
    description: 'REAUTHENTICATION_REQUIRED',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (10 per minute)',
  })
  async delete(
    @Body() body: DeleteAccountBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.identity.call(IdentityRpc.deleteMe, body, {
      accessToken,
      correlationId,
    });
    clearRefreshCookie(res);
  }
}
