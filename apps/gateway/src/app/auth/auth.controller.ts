import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiExcludeEndpoint,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IdentityRpc, type AuthSession } from '@borrowbox/contracts';
import {
  ApiErrorResponse,
  AuthResponse,
  LoginBody,
  RegisterBody,
} from '../api.dto';
import type { GatewayConfig } from '../config';
import {
  REFRESH_COOKIE,
  clearOAuthCookie,
  clearRefreshCookie,
  readOAuthCookie,
  setOAuthCookie,
  setRefreshCookie,
} from '../http/cookies';
import { AuthRateLimit, RefreshRateLimit } from '../http/rate-limits';
import { CorrelationId } from '../http/request-context';
import {
  IdentityClient,
  apiError,
  type ApiErrorBody,
} from '../identity/identity.client';

/** Hands the refresh token to the cookie and returns the rest. */
function toAuthResponse(res: Response, session: AuthSession): AuthResponse {
  setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
  return {
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    user: session.user,
  };
}

const b64url = (bytes: number) => randomBytes(bytes).toString('base64url');

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Error codes the web app's /auth/callback page knows how to show. */
const OAUTH_REDIRECT_ERRORS = new Set([
  'OAUTH_EXCHANGE_FAILED',
  'OAUTH_EMAIL_NOT_VERIFIED',
  'OAUTH_CANCELLED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
]);

@ApiTags('auth')
@ApiResponse({
  status: 429,
  type: ApiErrorResponse,
  description: 'RATE_LIMITED',
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly identity: IdentityClient,
    private readonly config: ConfigService<GatewayConfig, true>,
  ) {}

  @Post('register')
  @AuthRateLimit()
  @ApiOperation({ summary: 'Create an account and sign in' })
  @ApiCreatedResponse({
    type: AuthResponse,
    description: 'Also sets the httpOnly `bb_refresh` cookie',
  })
  @ApiResponse({
    status: 400,
    type: ApiErrorResponse,
    description: 'VALIDATION_FAILED',
  })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'EMAIL_TAKEN',
  })
  async register(
    @Body() body: RegisterBody,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const session = await this.identity.call(IdentityRpc.register, body, {
      correlationId,
    });
    return toAuthResponse(res, session);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit()
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({
    type: AuthResponse,
    description: 'Also sets the httpOnly `bb_refresh` cookie',
  })
  @ApiResponse({
    status: 401,
    type: ApiErrorResponse,
    description: 'INVALID_CREDENTIALS',
  })
  async login(
    @Body() body: LoginBody,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const session = await this.identity.call(IdentityRpc.login, body, {
      correlationId,
    });
    return toAuthResponse(res, session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RefreshRateLimit()
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary:
      'Get a new access token using the `bb_refresh` cookie (rotates it)',
  })
  @ApiOkResponse({ type: AuthResponse })
  @ApiResponse({
    status: 401,
    type: ApiErrorResponse,
    description: 'INVALID_REFRESH_TOKEN',
  })
  async refresh(
    @Req() req: Request,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const refreshToken: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_REFRESH_TOKEN',
        'Session expired, sign in again',
      );
    }
    try {
      const session = await this.identity.call(
        IdentityRpc.refresh,
        { refreshToken },
        { correlationId },
      );
      return toAuthResponse(res, session);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === 401) {
        clearRefreshCookie(res);
      }
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({ summary: 'End this session and clear the cookie' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken: unknown = req.cookies?.[REFRESH_COOKIE];
    clearRefreshCookie(res);
    if (typeof refreshToken === 'string' && refreshToken !== '') {
      await this.identity.call(
        IdentityRpc.logout,
        { refreshToken },
        { correlationId },
      );
    }
  }

  /** Browser navigation (not XHR): redirects to Google's consent screen. */
  @Get('google')
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Start Google sign-in (navigate the browser here)',
  })
  @ApiResponse({ status: 302, description: 'Redirect to Google' })
  googleStart(@Res() res: Response): void {
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    if (!clientId) return this.backToWeb(res, 'OAUTH_EXCHANGE_FAILED');

    const state = { s: b64url(16), n: b64url(16), v: b64url(32) };
    setOAuthCookie(res, state);
    const url = new URL(
      this.config.get('GOOGLE_AUTHORIZATION_ENDPOINT', { infer: true }),
    );
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
      response_type: 'code',
      scope: 'openid email profile',
      state: state.s,
      nonce: state.n,
      code_challenge: createHash('sha256').update(state.v).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    res.redirect(HttpStatus.FOUND, url.toString());
  }

  /** Google redirects here; we redirect on to the web app's /auth/callback. */
  @Get('google/callback')
  @AuthRateLimit()
  @ApiExcludeEndpoint()
  async googleCallback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Req() req: Request,
    @CorrelationId() correlationId: string,
    @Res() res: Response,
  ): Promise<void> {
    const saved = readOAuthCookie(req.signedCookies);
    clearOAuthCookie(res);

    if (error !== undefined) return this.backToWeb(res, 'OAUTH_CANCELLED');
    if (
      !saved ||
      typeof code !== 'string' ||
      code.length === 0 ||
      code.length > 2048 ||
      typeof state !== 'string' ||
      !sameString(state, saved.s)
    ) {
      return this.backToWeb(res, 'OAUTH_EXCHANGE_FAILED');
    }

    try {
      const session = await this.identity.call(
        IdentityRpc.googleExchange,
        {
          code,
          codeVerifier: saved.v,
          nonce: saved.n,
          redirectUri: this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
        },
        { correlationId },
      );
      setRefreshCookie(
        res,
        session.refreshToken,
        session.refreshTokenExpiresAt,
      );
      this.backToWeb(res);
    } catch (err) {
      const body =
        err instanceof HttpException
          ? (err.getResponse() as Partial<ApiErrorBody>)
          : undefined;
      this.backToWeb(res, body?.code ?? 'OAUTH_EXCHANGE_FAILED');
    }
  }

  /** The web app then calls POST /auth/refresh; no token ever travels in a URL. */
  private backToWeb(res: Response, errorCode?: string): void {
    const url = new URL(
      '/auth/callback',
      this.config.get('WEB_APP_URL', { infer: true }),
    );
    if (errorCode) {
      url.searchParams.set(
        'error',
        OAUTH_REDIRECT_ERRORS.has(errorCode)
          ? errorCode
          : 'OAUTH_EXCHANGE_FAILED',
      );
    }
    res.redirect(HttpStatus.FOUND, url.toString());
  }
}
