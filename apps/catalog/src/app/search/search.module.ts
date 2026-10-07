import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Public search and item pages. */
@Module({ controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
