import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '@borrowbox/auth';
import {
  BookingsRpc,
  CatalogRpc,
  IdentityRpc,
  MessagingRpc,
  NotificationsRpc,
  PaymentsRpc,
} from '@borrowbox/contracts';
import {
  ApiErrorResponse,
  ChangePasswordBody,
  DataExportResponse,
  DeleteAccountBody,
  UpdateProfileBody,
  UserProfileResponse,
} from '../api.dto';
import { BookingsClient, MessagingClient } from '../bookings/bookings.client';
import { CatalogClient } from '../catalog/catalog.client';
import { NotificationsClient } from '../notifications/notifications.client';
import { PaymentsClient } from '../payments/payments.client';
import { clearRefreshCookie } from '../http/cookies';
import { AuthRateLimit } from '../http/rate-limits';
import { AccessToken, CorrelationId } from '../http/request-context';
import { IdentityClient } from '../identity/identity.client';
import {
  ProfilePhotoUploadBody,
  ProfilePhotoUploadResponse,
} from '../profile-photo.api';

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
  constructor(
    private readonly identity: IdentityClient,
    private readonly catalog: CatalogClient,
    private readonly bookings: BookingsClient,
    private readonly messaging: MessagingClient,
    private readonly notifications: NotificationsClient,
    private readonly payments: PaymentsClient,
  ) {}

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

  @Post('verification-email')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Email me a new verification link',
    description:
      'Does nothing if the email is already verified, or within a minute of the last link. A new link replaces older ones.',
  })
  @ApiAcceptedResponse()
  async sendVerificationEmail(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.identity.call(
      IdentityRpc.sendVerificationEmail,
      {},
      { accessToken, correlationId },
    );
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Checks the password, so it gets the same limit as login.
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Change my password',
    description:
      'Signs out my other sessions; this one stays. Accounts without a password ask for a reset link instead (`POST /auth/password-reset`).',
  })
  @ApiNoContentResponse()
  @ApiResponse({
    status: 400,
    type: ApiErrorResponse,
    description: 'VALIDATION_FAILED',
  })
  @ApiResponse({
    status: 401,
    type: ApiErrorResponse,
    description: 'INVALID_CREDENTIALS (wrong current password)',
  })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'PASSWORD_NOT_SET',
  })
  async changePassword(
    @Body() body: ChangePasswordBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.identity.call(IdentityRpc.changePassword, body, {
      accessToken,
      correlationId,
    });
  }

  // --- profile photo (ADR-0024) -------------------------------------------------

  @Post('photo')
  @ApiOperation({
    summary: 'Start a new profile photo',
    description:
      'Returns a presigned URL: PUT the file there with uploadHeaders, then confirm. Replaces an upload still waiting; the current photo stays until the new one is ready. Photos are public, like the display name.',
  })
  @ApiCreatedResponse({ type: ProfilePhotoUploadResponse })
  @ApiResponse({
    status: 400,
    type: ApiErrorResponse,
    description: 'VALIDATION_FAILED',
  })
  requestPhotoUpload(
    @Body() body: ProfilePhotoUploadBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<ProfilePhotoUploadResponse> {
    return this.identity.call(IdentityRpc.requestPhotoUpload, body, {
      accessToken,
      correlationId,
    });
  }

  @Post('photo/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The upload has finished: process the new photo',
    description:
      'Processing takes a few seconds: `photoUpload` is PENDING meanwhile, then null with the new `photo`, or FAILED. Repeating it is safe.',
  })
  @ApiOkResponse({ type: UserProfileResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE (no upload waiting, or not uploaded yet)',
  })
  confirmPhoto(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<UserProfileResponse> {
    return this.identity.call(
      IdentityRpc.confirmPhoto,
      {},
      { accessToken, correlationId },
    );
  }

  @Delete('photo')
  @ApiOperation({
    summary: 'Remove my profile photo',
    description: 'Also drops an upload still waiting. A no-op without one.',
  })
  @ApiOkResponse({ type: UserProfileResponse })
  removePhoto(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<UserProfileResponse> {
    return this.identity.call(
      IdentityRpc.removePhoto,
      {},
      { accessToken, correlationId },
    );
  }

  @Get('export')
  @Header(
    'Content-Disposition',
    'attachment; filename="borrowbox-data-export.json"',
  )
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Download all my personal data (GDPR Art. 15/20)',
    description:
      'One section per service. If any service is unavailable, the whole export fails with 503: try again.',
  })
  @ApiOkResponse({ type: DataExportResponse })
  async export(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<DataExportResponse> {
    // All or nothing (G4): if any service doesn't answer, the whole export
    // fails and can be retried, rather than silently missing data.
    const context = { accessToken, correlationId };
    const [identity, catalog, bookings, messaging, notifications, payments] =
      await Promise.all([
        this.identity.call(IdentityRpc.exportMe, {}, context),
        this.catalog.call(CatalogRpc.exportMe, {}, context),
        this.bookings.call(BookingsRpc.exportMe, {}, context),
        this.messaging.call(MessagingRpc.exportMe, {}, context),
        this.notifications.call(NotificationsRpc.exportMe, {}, context),
        this.payments.call(PaymentsRpc.exportMe, {}, context),
      ]);
    return { identity, catalog, bookings, messaging, notifications, payments };
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
