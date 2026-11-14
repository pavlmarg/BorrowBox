import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CatalogRpc,
  type CategoryCountsResponse,
  type FeaturedItemsResponse,
  type LenderItemsResponse,
  type PublicItemDetail,
  type SearchItemsResponse,
  type SimilarItemsResponse,
  type SuggestItemsResponse,
  type SuggestPeopleResponse,
} from '@borrowbox/contracts';
import { ItemRefDto } from '../items/items.dto';
import {
  CategoryCountsDto,
  FeaturedItemsDto,
  LenderItemsDto,
  SearchItemsDto,
  SuggestItemsDto,
  SuggestPeopleDto,
} from './search.dto';
import { SearchService } from './search.service';

/** Public: no access token needed (signed-out visitors may browse). */
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @MessagePattern(CatalogRpc.search)
  find(@Payload('data') dto: SearchItemsDto): Promise<SearchItemsResponse> {
    return this.search.search(dto);
  }

  @MessagePattern(CatalogRpc.suggest)
  suggest(
    @Payload('data') dto: SuggestItemsDto,
  ): Promise<SuggestItemsResponse> {
    return this.search.suggest(dto);
  }

  @MessagePattern(CatalogRpc.getPublic)
  getPublic(@Payload('data') dto: ItemRefDto): Promise<PublicItemDetail> {
    return this.search.getPublic(dto.itemId);
  }

  @MessagePattern(CatalogRpc.similar)
  similar(@Payload('data') dto: ItemRefDto): Promise<SimilarItemsResponse> {
    return this.search.similar(dto.itemId);
  }

  @MessagePattern(CatalogRpc.categoryCounts)
  categoryCounts(
    @Payload('data') dto: CategoryCountsDto,
  ): Promise<CategoryCountsResponse> {
    return this.search.categoryCounts(dto);
  }

  @MessagePattern(CatalogRpc.suggestPeople)
  suggestPeople(
    @Payload('data') dto: SuggestPeopleDto,
  ): Promise<SuggestPeopleResponse> {
    return this.search.suggestPeople(dto);
  }

  @MessagePattern(CatalogRpc.lenderItems)
  lenderItems(
    @Payload('data') dto: LenderItemsDto,
  ): Promise<LenderItemsResponse> {
    return this.search.lenderItems(dto.lenderId);
  }

  @MessagePattern(CatalogRpc.featured)
  featured(
    @Payload('data') dto: FeaturedItemsDto,
  ): Promise<FeaturedItemsResponse> {
    return this.search.featured(dto);
  }
}
