import { Controller, Inject, UseGuards } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  NotificationsRpc,
  type NotificationsDataExport,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { listJobsOf } from '../emails/email-jobs.repository';
import { findRecipient } from '../recipients/recipients.repository';

/** GDPR export: Notifications' part of `GET /me/export`. */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class ExportController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @MessagePattern(NotificationsRpc.exportMe)
  async exportMe(
    @CurrentUser() user: AuthUser,
  ): Promise<NotificationsDataExport> {
    const tx = this.dataSource.manager;
    const recipient = await findRecipient(tx, user.userId);
    const live = recipient && !recipient.deleted_at ? recipient : null;
    return {
      exportedAt: new Date().toISOString(),
      recipient:
        live?.email && live.display_name && live.locale
          ? {
              email: live.email,
              displayName: live.display_name,
              locale: live.locale,
              updatedAt: live.updated_at.toISOString(),
            }
          : null,
      emails: (await listJobsOf(tx, user.userId)).map((job) => ({
        kind: job.kind,
        createdAt: job.created_at.toISOString(),
        sentAt: job.sent_at?.toISOString() ?? null,
      })),
    };
  }
}
