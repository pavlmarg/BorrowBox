import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CatalogRpc } from '@borrowbox/contracts';
import { ApiErrorResponse } from '../api.dto';
import { CatalogClient } from '../catalog/catalog.client';
import { SuggestRateLimit } from '../http/rate-limits';
import { CorrelationId } from '../http/request-context';
import {
  PublicItemDetailResponse,
  SearchItemsBody,
  SearchItemsResponse,
  SimilarItemsResponse,
  SuggestItemsBody,
  SuggestItemsResponse,
} from './items.api';

/**
 * Public browsing: no sign-in needed. Only fuzzed locations ever leave
 * (ADR-0007). Search sends its point in the body, not the URL, so it never
 * lands in access logs or browser history (G2).
 */
@ApiTags('items')
@ApiResponse({
  status: 400,
  type: ApiErrorResponse,
  description: 'VALIDATION_FAILED',
})
@Controller('items')
export class PublicItemsController {
  constructor(private readonly catalog: CatalogClient) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search active items near a point',
    description:
      'Nearest first (by the fuzzed point). Page with nextCursor. The point is used for this search only.',
  })
  @ApiOkResponse({ type: SearchItemsResponse })
  search(
    @Body() body: SearchItemsBody,
    @CorrelationId() correlationId: string,
  ): Promise<SearchItemsResponse> {
    return this.catalog.call(CatalogRpc.search, body, { correlationId });
  }

  @Post('suggest')
  @HttpCode(HttpStatus.OK)
  @SuggestRateLimit()
  @ApiOperation({
    summary: 'Search as you type: up to 5 nearby matches',
    description: 'From 2 characters; 300 requests per minute per IP.',
  })
  @ApiOkResponse({ type: SuggestItemsResponse })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (300 per minute)',
  })
  suggest(
    @Body() body: SuggestItemsBody,
    @CorrelationId() correlationId: string,
  ): Promise<SuggestItemsResponse> {
    return this.catalog.call(CatalogRpc.suggest, body, { correlationId });
  }

  @Get(':itemId')
  @ApiOperation({ summary: 'An active item’s public page' })
  @ApiOkResponse({ type: PublicItemDetailResponse })
  @ApiResponse({
    status: 404,
    type: ApiErrorResponse,
    description: 'NOT_FOUND',
  })
  get(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CorrelationId() correlationId: string,
  ): Promise<PublicItemDetailResponse> {
    return this.catalog.call(
      CatalogRpc.getPublic,
      { itemId },
      { correlationId },
    );
  }

  @Get(':itemId/similar')
  @ApiOperation({
    summary: 'Up to 8 similar items from other lenders nearby',
  })
  @ApiOkResponse({ type: SimilarItemsResponse })
  @ApiResponse({
    status: 404,
    type: ApiErrorResponse,
    description: 'NOT_FOUND',
  })
  similar(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CorrelationId() correlationId: string,
  ): Promise<SimilarItemsResponse> {
    return this.catalog.call(CatalogRpc.similar, { itemId }, { correlationId });
  }
}
