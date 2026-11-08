import { ApiProperty } from '@nestjs/swagger';
import {
  MONEY_MOVEMENT_STATUSES,
  PAYMENT_STATUSES,
  PAYOUT_STATUSES,
  type MoneyMovementStatus,
  type PaymentStatus,
  type PayoutStatus,
} from '@borrowbox/contracts';

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

export class PaymentViewResponse {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({
    enum: PAYMENT_STATUSES,
    enumName: 'PaymentStatus',
    description:
      'REQUIRES_PAYMENT (also after a failed attempt), PROCESSING, SUCCEEDED, CANCELLED (the booking closed unpaid), NEEDS_REFUND (the refund is on its way), REFUNDED (a cancelled booking was refunded), SETTLED (completed: the lender was paid, the deposit returned)',
  })
  status!: PaymentStatus;
  @ApiProperty() rentCents!: number;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ description: 'The service fee (ADR-0020)' })
  feeCents!: number;
  @ApiProperty({ description: 'What the renter pays: rent + deposit + fee' })
  chargeCents!: number;
  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'When the booking expires unless paid',
  })
  payBy!: string | null;
  @ApiProperty({
    description: 'The last attempt failed; the renter may try again',
  })
  lastAttemptFailed!: boolean;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  paidAt!: string | null;
  @ApiProperty({
    description:
      'Back to the renter so far: a refund or the deposit (ADR-0021)',
  })
  refundedCents!: number;
}

export class CheckoutResponse extends PaymentViewResponse {
  @ApiProperty({
    description:
      "For Stripe's payment form in this browser only: never log, store or share it",
  })
  clientSecret!: string;
}

export class ExportedPayment {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: PAYMENT_STATUSES, enumName: 'PaymentStatus' })
  status!: PaymentStatus;
  @ApiProperty() chargeCents!: number;
  @ApiProperty() refundedCents!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  paidAt!: string | null;
}

export class ExportedPayout {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty({
    enum: MONEY_MOVEMENT_STATUSES,
    enumName: 'MoneyMovementStatus',
  })
  status!: MoneyMovementStatus;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PaymentsDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: ExportedPayoutAccount, nullable: true })
  payoutAccount!: ExportedPayoutAccount | null;
  @ApiProperty({ type: [ExportedPayment] })
  payments!: ExportedPayment[];
  @ApiProperty({
    type: [ExportedPayout],
    description: 'What BorrowBox transferred to the caller as a lender',
  })
  payouts!: ExportedPayout[];
}
