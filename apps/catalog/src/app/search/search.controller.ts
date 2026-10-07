import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CatalogRpc,
  type PublicItemDetail,
  type SearchItemsResponse,
  type SimilarItemsResponse,
  type SuggestItemsResponse,
} from '@borrowbox/contracts';
import { ItemRefDto } from '../items/items.dto';
import { SearchItemsDto, SuggestItemsDto } from './search.dto';
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
}
