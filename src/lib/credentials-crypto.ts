import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// Passwords and notes are encrypted here, in the app server, with AES-256-GCM before they reach the
// database. The key comes only from the server environment (CREDENTIALS_ENCRYPTION_KEY, 32 random
// bytes in base64) and is never sent to the browser or stored in the database. Each value is bound
// to its credential and field, so an encrypted value cannot be moved to another row or field.

export type KeyStatus = 'ok' | 'missing' | 'invalid';
export type SecretField = 'password' | 'notes';

export class CredentialKeyError extends Error {}

function loadKey(): { status: KeyStatus; key?: Buffer } {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) return { status: 'missing' };
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { status: 'invalid' };
  const key = Buffer.from(b64, 'base64');
  return key.length === 32 ? { status: 'ok', key } : { status: 'invalid' };
}

export function keyStatus(): KeyStatus {
  return loadKey().status;
}

function requireKey(): Buffer {
  const k = loadKey();
  if (k.key) return k.key;
  throw new CredentialKeyError(
    k.status === 'missing'
      ? 'The credential manager is not set up yet: the encryption key is missing from the server settings.'
      : 'The encryption key in the server settings is not a valid 32-byte key.',
  );
}

/** A short fingerprint of the key (not the key), stored with each value to catch a changed key. */
export function keyId(): string {
  return createHmac('sha256', requireKey()).update('opspulse-credentials-key-id').digest('hex').slice(0, 16);
}

export function encryptField(plain: string, credentialId: string, field: SecretField): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', requireKey(), iv);
  cipher.setAAD(Buffer.from(`${credentialId}:${field}`, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function decryptField(value: string, credentialId: string, field: SecretField, storedKeyId: string): string {
  if (storedKeyId !== keyId()) {
    throw new CredentialKeyError('This login was saved with a different encryption key, so it cannot be read with the current one.');
  }
  const [version, iv, body, tag] = value.split('.');
  if (version !== 'v1' || !iv || !body || !tag) throw new CredentialKeyError('This saved value is not in a format the app can read.');
  const decipher = createDecipheriv('aes-256-gcm', requireKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(`${credentialId}:${field}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
