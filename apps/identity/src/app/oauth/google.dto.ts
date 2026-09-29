import { IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import type { GoogleExchangeRequest } from '@borrowbox/contracts';

export class GoogleExchangeDto implements GoogleExchangeRequest {
  @IsString()
  @MaxLength(2048)
  code!: string;

  /** RFC 7636: 43–128 unreserved characters. */
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/)
  codeVerifier!: string;

  @IsString()
  @MaxLength(256)
  nonce!: string;

  /** Must be the redirect URI registered with Google; Google rejects any other. */
  @IsUrl({
    protocols: ['http', 'https'],
    require_tld: false,
    require_protocol: true,
  })
  @MaxLength(2048)
  redirectUri!: string;
}
