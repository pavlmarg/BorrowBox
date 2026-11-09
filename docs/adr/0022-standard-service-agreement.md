# ADR-0022: Standard service agreement for lenders

**Status:** Accepted. Amends [ADR-0019](0019-payments-fees-and-policies.md), which put lenders' Stripe accounts under the recipient service agreement. Builds on [ADR-0003](0003-stripe-separate-charges-transfers.md).

## Context
ADR-0019 created each lender's Express account with only the `transfers` capability under Stripe's **recipient** service agreement, so lenders would only ever receive transfers. The live run in Stripe's sandbox showed two things:
- Stripe refuses the recipient agreement for a platform in Greece creating accounts in Greece: *"The recipient ToS agreement is not supported for platforms in GR creating accounts in GR."* The recipient agreement exists only for cross-border payouts.
- Creating Express accounts with the v1 API (`type: express`) needs the platform to have acknowledged, in its Connect platform profile, that it carries losses on connected accounts. Without it Stripe pointed to Accounts v2, which can't sign the recipient agreement and doesn't document much of what Payments relies on.

## Decision
- Lenders' accounts are created under Stripe's **standard ("full") service agreement**, still as Express accounts with only the `transfers` capability requested. They still can't take card payments: every charge, refund and dispute stays on the platform account (ADR-0003).
- The platform **carries losses** on connected accounts (a negative balance Stripe can't recover from the lender), acknowledged in the Connect platform profile. Express accounts work that way.
- We stay on the Accounts v1 API. Moving to Accounts v2 is revisited only if Stripe closes v1 for Express accounts.

## Consequences
- The request to Stripe sends one field less; nothing personal is added (ADR-0019's rule stands).
- A lender's balance can only go negative through a transfer reversal, which BorrowBox never makes today, so the loss risk is small. A real launch still needs the platform profile completed in the live account.
- Stripe's onboarding may ask lenders a little more under the standard agreement (e.g. what they do, or a website, for which a short description works).
- Lenders in another country than the platform would need the recipient agreement again (`STRIPE_ACCOUNT_COUNTRY` differs from the platform's): not supported until there's a market for it.
