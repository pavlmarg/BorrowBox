#!/usr/bin/env node
// Generates an Ed25519 keypair for access tokens (libs/auth) and prints env lines.
// Newlines are escaped as \n; services restore them with pemFromEnv().
//
//   node tools/gen-jwt-keys.mjs
//
// Paste JWT_PRIVATE_KEY into Identity's env only. JWT_PUBLIC_KEY and JWT_KEY_ID
// go to the gateway and every service. Never commit the output.
import { generateKeyPairSync, randomUUID } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const escape = (pem) => pem.trim().replace(/\n/g, '\\n');
const keyId = `dev-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

console.log(`JWT_KEY_ID=${keyId}`);
console.log(`JWT_PUBLIC_KEY="${escape(publicKey)}"`);
console.log(`JWT_PRIVATE_KEY="${escape(privateKey)}"`);
