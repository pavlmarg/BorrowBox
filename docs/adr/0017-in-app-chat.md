# ADR-0017: In-app chat before and during bookings

**Status:** Accepted. Replaces ARCHITECTURE.md's original Messaging plan (chat unlocked only after payment, fixed quick questions before that). Completes the "arrange where to meet" message of [ADR-0015](0015-booking-model.md).

## Context
The original plan opened a booking's chat only once payment succeeded, with fixed quick questions before. Two things changed:

- People want to talk **before** agreeing on anything: ask about the item, check it fits, negotiate the price ([ADR-0018](0018-price-offers.md)).
- The exact location is never revealed ([ADR-0015](0015-booking-model.md)), so once a booking goes ahead the two people must arrange where and when to meet. Chat is where that happens.

Free text from the first message makes it easy to take a deal off the platform before any trust exists, and it adds personal data that must be exported, erased and kept no longer than needed.

## Decision

### Conversations
- **One conversation per item and asker.** Anyone signed in with a verified email can start one about an `ACTIVE` item that isn't their own. The lender replies but can't start one.
- The same conversation carries on into every booking between the two about that item. Requesting a booking without having chatted creates it.
- Both can write for as long as the conversation exists. It becomes read-only when the item is deleted or either account is erased.
- **Messages are text only**, 1–2000 characters. The client picks a message's id, so a retried send doesn't duplicate it.
- **Read state:** each person's "read up to" time, for unread counts and "seen".
- **System lines** mark booking moments (requested, accepted, confirmed, declined, cancelled, expired) and price offers. They carry a code, not text; the PWA translates them. `CONFIRMED` (and `PAID` from Phase 4) asks both to arrange where and when to meet.

### Contact details
- Messages are stored as written. **Phone numbers, email addresses and links are masked when read** as long as the two people have no booking of that item that went ahead (`CONFIRMED`, `PAID` or later). Once they do, everything shows unmasked, earlier messages included. A sender always sees their own messages unmasked.
- This is friction, not security: spelled-out numbers get through. It keeps casual deals on the platform until there's a booking.

### Delivery
- Messages are sent over REST (`POST /api/conversations/:id/messages`), which reuses validation, rate limits and the RPC path.
- After the commit, Bookings publishes the new message (masked for the recipient) on the Redis channel `chat:<userId>` of each participant. Every gateway instance subscribes and pushes it over Socket.IO (`/chat`) to that user's room. A lost push isn't a problem: the PWA fetches what it missed on reconnect or when it opens a conversation.
- Sockets authenticate with the access token in the handshake (`auth.token`, never the URL) and are disconnected when it expires; the client reconnects with a fresh one. Origins come from the CORS allow-list.
- **Email:** 2 minutes after a message, if the recipient hasn't read it and wasn't reminded about that conversation in the last 30 minutes, Bookings emits `conversation.unread.v1`; Notifications emails a link. Emails and events never contain message text.

### Limits
- Per user, counted in the gateway: 30 messages per minute, 20 new conversations per day.

### Privacy and retention
- `message.sent.v1` carries ids only, no text.
- Erasing an account removes the text of its messages ("[deleted]") and withdraws its open offers. Conversations with no message for 2 years are deleted by a daily sweep.
- A message can be reported (spam, scam, abuse, other); reports wait for the admin area.
- The data export includes the person's conversations, their own messages, offers and reports.

### Where it lives
- A module of `apps/bookings` with tables in the `bookings` schema, until the event contracts settle; then it moves to `apps/messaging`.

## Consequences
- Negotiating and arranging the meeting happen in one place, and both are visible to dispute handling later.
- Masking at read time means contact details become visible once a booking goes ahead, without losing what was written. It also means the raw text is stored from the start, which the export and erasure cover.
- Live delivery adds Socket.IO to the gateway (three new dependencies, plus the client) and personal data in Redis pub/sub, in memory only and never logged.
- Moving Messaging out of Bookings later needs migrations in both schemas.
