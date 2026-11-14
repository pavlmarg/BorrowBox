# ADR-0025: Public profiles, bios and finding people

**Status:** Accepted. Builds on [ADR-0024](0024-profile-photos.md) (profile photos); replaces ARCHITECTURE's "People are never searchable by name" with the narrower rule below. Leaves [ADR-0017](0017-in-app-chat.md) (chat) unchanged.

## Context
People only appeared next to their items (name and photo) and in chat. Renters want to see who they borrow from, what else that person lends, and simple instructions ("Message me after 9"); people want to find a neighbour they already know. All of this is personal data shown to strangers, so it must stay small, opt-in by being a lender, and covered by export and erasure. Chat masks contact details until a booking goes ahead (ADR-0017); a public text must not undo that.

## Decision
- **Public profile** (`/users/:id`, also for signed-out visitors, like item pages): photo, display name, bio, member-since date and the person's ACTIVE items. Never the email, language or sign-in methods. Every account has one; unknown and erased accounts answer `404 NOT_FOUND` alike. Addressed by account id (no usernames or handles). `/profile` shows my own exactly as others see it, with "Edit profile" → Settings.
- **Who owns what:** Identity serves the profile (`identity.users.public.get`), Catalog the items (`catalog.lenders.items`: newest first, at most 10, so no paging). The PWA asks for both; the gateway doesn't combine them.
- **Bio:** at most 150 characters and 3 lines, trimmed, line breaks kept; one shared rule in `libs/contracts` (`normaliseBio`, `bioProblem`) used by the PWA, the gateway and Identity. Phone numbers, emails and links are **refused** (not masked) with the chat's detector, now `hasContactDetails`/`maskContacts` in `libs/contracts`. Edited in Settings; an empty bio removes it.
- **Bio in events:** `user.profile_updated.v1` gains an optional `bio` (like `photo`: absent keeps, null clears; newest wins). Additive, so no `v2`. Catalog keeps it with lender names and shows it on the item page's lender block; Bookings and Notifications ignore it.
- **Message button:** chats stay about one item. With one item it opens that conversation, with several a menu asks which, without items there is no button.
- **Finding people:** only in Explore's search bar suggestions, in a "People" group apart from "Items"; never in results, the map or the carousel. Only lenders with at least one ACTIVE item can be found (anywhere, not only nearby); someone who only rents is never findable by name. Every typed word must start a word of the name, case and Greek accents ignored; most items first; at most 5. `POST /people/suggest` sends the text in the body, never stored or logged, 300 per minute per IP.
- **Seen elsewhere:** Explore's result rows show who posted the item ("Posted by" + name, linking to the profile); the featured carousel only their photo; the item page links the lender to their profile and lists "More from <name>".
- **GDPR:** Identity's export has the bio; erasure blanks it with the name and photo and redacts it in kept outbox rows; Catalog's export lists its copy and forgets it on `user.deletion_requested`.

## Consequences
- Lenders become listable by name: anyone can try prefixes within the rate limit. Accepted: lenders already show their name next to public items; renters stay unfindable.
- No moderation yet: an offensive bio or photo stays until the admin area (reports, suspensions) exists.
- The contact-detail rule is friction, not security (spelled-out numbers get through), as in chat.
- Catalog's copy of the bio follows Identity's events; after changing it, the item page may show the old bio for a moment.
