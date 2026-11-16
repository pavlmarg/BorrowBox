#!/usr/bin/env node
// Generates the Ed25519 key that signs handoff QR tokens (ARCHITECTURE.md §5)
// and prints its env line. Newlines are escaped as \n; Bookings restores them
// with pemFromEnv().
//
//   node tools/gen-handoff-key.mjs
//
// Paste HANDOFF_PRIVATE_KEY into Bookings' env only: Bookings both signs and
// checks these tokens. Never commit the output.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

console.log(`HANDOFF_PRIVATE_KEY="${privateKey.trim().replace(/\n/g, '\\n')}"`);
