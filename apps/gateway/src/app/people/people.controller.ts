import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CatalogRpc, IdentityRpc } from '@borrowbox/contracts';
import { ApiErrorResponse } from '../api.dto';
import { CatalogClient } from '../catalog/catalog.client';
import { UuidParam } from '../http/params';
import { SuggestRateLimit } from '../http/rate-limits';
import { CorrelationId } from '../http/request-context';
import { IdentityClient } from '../identity/identity.client';
import {
  LenderItemsResponse,
  PublicProfileResponse,
  SuggestPeopleBody,
  SuggestPeopleResponse,
} from './people.api';

/**
 * Public profiles (ADR-0025): no sign-in needed, like item pages. The
 * profile comes from Identity, the items from Catalog; the PWA asks for
 * both, so neither waits for the other.
 */
@ApiTags('people')
@ApiResponse({
  status: 400,
  type: ApiErrorResponse,
  description: 'VALIDATION_FAILED',
})
@Controller('users')
export class UsersController {
  constructor(
    private readonly identity: IdentityClient,
    private readonly catalog: CatalogClient,
  ) {}

  @Get(':userId')
  @ApiOperation({
    summary: 'Someone’s public profile',
    description: 'Name, photo, bio and member-since date; never the email.',
  })
  @ApiOkResponse({ type: PublicProfileResponse })
  @ApiResponse({
    status: 404,
    type: ApiErrorResponse,
    description: 'NOT_FOUND (unknown or deleted account)',
  })
  profile(
    @UuidParam('userId') userId: string,
    @CorrelationId() correlationId: string,
  ): Promise<PublicProfileResponse> {
    return this.identity.call(
      IdentityRpc.getPublicProfile,
      { userId },
      { correlationId },
    );
  }

  @Get(':userId/items')
  @ApiOperation({
    summary: 'Someone’s active items, newest first',
    description: 'At most 10; empty for unknown or deleted accounts.',
  })
  @ApiOkResponse({ type: LenderItemsResponse })
  items(
    @UuidParam('userId') userId: string,
    @CorrelationId() correlationId: string,
  ): Promise<LenderItemsResponse> {
    return this.catalog.call(
      CatalogRpc.lenderItems,
      { lenderId: userId },
      { correlationId },
    );
  }
}

/** Name search for Explore's search bar (ADR-0025): only lenders with an active item. */
@ApiTags('people')
@Controller('people')
export class PeopleController {
  constructor(private readonly catalog: CatalogClient) {}

  @Post('suggest')
  @HttpCode(HttpStatus.OK)
  @SuggestRateLimit()
  @ApiOperation({
    summary: 'Find lenders by name as you type: up to 5',
    description:
      'From 2 characters; every typed word must start a word of the name. The text travels in the body and is never stored or logged. 300 requests per minute per IP.',
  })
  @ApiOkResponse({ type: SuggestPeopleResponse })
  @ApiResponse({
    status: 400,
    type: ApiErrorResponse,
    description: 'VALIDATION_FAILED',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (300 per minute)',
  })
  suggest(
    @Body() body: SuggestPeopleBody,
    @CorrelationId() correlationId: string,
  ): Promise<SuggestPeopleResponse> {
    return this.catalog.call(CatalogRpc.suggestPeople, body, {
      correlationId,
    });
  }
}
