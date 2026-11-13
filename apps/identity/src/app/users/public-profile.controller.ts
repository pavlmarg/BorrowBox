import { Controller, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import { IdentityRpc, type PublicProfile } from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { IdentityConfig } from '../config';
import { IdentityError } from '../rpc/rpc-errors';
import { PublicProfileDto } from './me.dto';
import { findPublicProfile } from './user-profile';

/** Public (no access token): anyone's profile page (ADR-0025). */
@Controller()
export class PublicProfileController {
  private readonly photosBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    config: ConfigService<IdentityConfig, true>,
  ) {
    this.photosBaseUrl = config.get('PHOTOS_BASE_URL', { infer: true });
  }

  /** Unknown and erased accounts look the same: NOT_FOUND. */
  @MessagePattern(IdentityRpc.getPublicProfile)
  async get(@Payload('data') dto: PublicProfileDto): Promise<PublicProfile> {
    const profile = await findPublicProfile(
      this.dataSource.manager,
      dto.userId,
      this.photosBaseUrl,
    );
    if (!profile) throw new IdentityError('NOT_FOUND', 'Profile not found');
    return profile;
  }
}
