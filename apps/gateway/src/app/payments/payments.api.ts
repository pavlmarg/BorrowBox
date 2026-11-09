import { ApiProperty } from '@nestjs/swagger';
import { PAYOUT_STATUSES, type PayoutStatus } from '@borrowbox/contracts';

// HTTP DTOs for Payments (responses only: its commands take no body), and
// the source of the OpenAPI spec the PWA client is generated from.

export class PayoutAccountResponse {
  @ApiProperty({
    enum: PAYOUT_STATUSES,
    enumName: 'PayoutStatus',
    description:
      'NOT_STARTED, INCOMPLETE (Stripe needs details), PENDING (Stripe is checking), READY, RESTRICTED (Stripe disabled payouts)',
  })
  status!: PayoutStatus;

  @ApiProperty({
    description: "Whether Stripe pays out the balance to the lender's bank",
  })
  payoutsEnabled!: boolean;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'When Stripe last reported on the account',
  })
  updatedAt!: string | null;
}

export class StripeLinkResponse {
  @ApiProperty({
    format: 'uri',
    description: 'A single-use Stripe page; send the browser there',
  })
  url!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  expiresAt!: string | null;
}

export class ExportedPayoutAccount extends PayoutAccountResponse {
  @ApiProperty({ nullable: true, type: String })
  stripeAccountId!: string | null;

  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PaymentsDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: ExportedPayoutAccount, nullable: true })
  payoutAccount!: ExportedPayoutAccount | null;
}
