import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import {
  ITEM_CATEGORIES,
  SEARCH_QUERY_MAX_LENGTH,
  SUGGEST_MIN_LENGTH,
  type ItemCategory,
  type LenderItemSummary,
  type LenderItemsResponse as LenderItemsContract,
  type PersonSuggestion,
  type PublicProfile,
  type SuggestPeopleRequest,
  type SuggestPeopleResponse as SuggestPeopleContract,
} from '@borrowbox/contracts';
import {
  CharLength,
  ItemPricingBody,
  PhotoUrlsResponse,
} from '../items/items.api';
import { ProfilePhotoUrlsResponse } from '../profile-photo.api';

// People (ADR-0025): public profiles, a lender's items and name search.

export class PublicProfileResponse implements PublicProfile {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({
    type: ProfilePhotoUrlsResponse,
    nullable: true,
    description: 'Public profile photo (ADR-0024); null for none',
  })
  photo!: ProfilePhotoUrlsResponse | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Up to 150 characters, 3 lines',
  })
  bio!: string | null;
  @ApiProperty({ format: 'date-time' }) memberSince!: string;
}

export class LenderItemResponse implements LenderItemSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  category!: ItemCategory;
  @ApiProperty({ type: ItemPricingBody }) pricing!: ItemPricingBody;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ type: PhotoUrlsResponse, nullable: true })
  coverPhoto!: PhotoUrlsResponse | null;
}

export class LenderItemsResponse implements LenderItemsContract {
  @ApiProperty({
    type: [LenderItemResponse],
    description: 'Active items, newest first (at most 10)',
  })
  items!: LenderItemResponse[];
}

export class SuggestPeopleBody implements SuggestPeopleRequest {
  @ApiProperty({
    minLength: SUGGEST_MIN_LENGTH,
    maxLength: SEARCH_QUERY_MAX_LENGTH,
    description: 'What has been typed so far; never stored or logged',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @CharLength(SUGGEST_MIN_LENGTH, SEARCH_QUERY_MAX_LENGTH)
  q!: string;
}

export class PersonSuggestionResponse implements PersonSuggestion {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty({ description: 'How many active items they have' })
  itemCount!: number;
}

export class SuggestPeopleResponse implements SuggestPeopleContract {
  @ApiProperty({ type: [PersonSuggestionResponse] })
  people!: PersonSuggestionResponse[];
}
