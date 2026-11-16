import { hasContactDetails } from '../messaging/contacts';

/**
 * Damage claims (ADR-0028): within the claim window after the return, the
 * lender may claim up to the deposit for damage. The renter agrees (the
 * award is settled at once) or disagrees (an admin decides, Phase 6); the
 * lender may withdraw. One claim per booking; it can't be edited.
 */

/** The smallest claim: €1. The largest is the booking's deposit. */
export const CLAIM_MIN_CENTS = 100;
export const CLAIM_DESCRIPTION_MIN_LENGTH = 10;
export const CLAIM_DESCRIPTION_MAX_LENGTH = 1000;
export const CLAIM_REPLY_MAX_LENGTH = 500;
/** Condition photos a claim may point to. */
export const CLAIM_PHOTOS_MAX = 6;

/**
 * `OPEN`: waiting for the renter. `DISAGREED`: the renter disagrees; an
 * admin decides. `AGREED`, `WITHDRAWN`, `DECIDED`: resolved, with an award
 * (the claim's amount, nothing, or what the admin decided).
 */
export const CLAIM_STATUSES = [
  'OPEN',
  'DISAGREED',
  'AGREED',
  'WITHDRAWN',
  'DECIDED',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Who resolved a dispute (`dispute.resolved.v1`). */
export const DISPUTE_RESOLUTIONS = [
  'RENTER_AGREED',
  'LENDER_WITHDREW',
  'ADMIN',
] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export const CLAIM_ANSWERS = ['AGREE', 'DISAGREE'] as const;
export type ClaimAnswer = (typeof CLAIM_ANSWERS)[number];

export interface ClaimView {
  bookingId: string;
  amountCents: number;
  /** The lender's description of the damage. */
  description: string;
  /** Condition photos (ADR-0027) the lender points to. */
  photoIds: string[];
  status: ClaimStatus;
  /** The renter's reply, if they gave one. */
  reply: string | null;
  filedAt: string;
  answeredAt: string | null;
  resolvedAt: string | null;
  /** Once resolved: what goes to the lender from the deposit. */
  awardCents: number | null;
}

/** Chat and claim texts may not carry contact details (as in bios and chat). */
export function claimTextProblem(
  text: string,
  min: number,
  max: number,
): 'TOO_SHORT' | 'TOO_LONG' | 'CONTACT_DETAILS' | null {
  const trimmed = text.trim();
  if (trimmed.length < min) return 'TOO_SHORT';
  if (trimmed.length > max) return 'TOO_LONG';
  if (hasContactDetails(trimmed)) return 'CONTACT_DETAILS';
  return null;
}

// --- requests ---------------------------------------------------------------

export interface FileClaimRequest {
  bookingId: string;
  amountCents: number;
  description: string;
  photoIds?: string[];
}

export interface AnswerClaimRequest {
  bookingId: string;
  answer: ClaimAnswer;
  reply?: string;
}

/** `null` while there's no claim. */
export interface ClaimResponse {
  claim: ClaimView | null;
}
