import { decodeText, encodeText, fromBase64Url, toBase64Url } from '../lib/encoding';
import type { ProjectSessionPayload } from './types';

const algorithm = { name: 'HMAC', hash: 'SHA-256' } as const;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', toArrayBuffer(encodeText(secret)), algorithm, false, ['sign', 'verify']);

const signBytes = async (payload: Uint8Array, secret: string): Promise<Uint8Array> => {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(algorithm.name, key, toArrayBuffer(payload));
  return new Uint8Array(signature);
};

export const createOpaqueSlug = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(18)));

export const createAccessKey = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(24)));

export const hashAccessKey = async (key: string, secret: string): Promise<string> => {
  const signature = await signBytes(encodeText(key), secret);
  return toBase64Url(signature);
};

export const constantTimeEquals = (left: string, right: string): boolean => {
  const a = encodeText(left);
  const b = encodeText(right);
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a[index] ^ b[index];
  }
  return mismatch === 0;
};

export const verifyAccessKey = async (
  candidate: string,
  storedHash: string,
  secret: string
): Promise<boolean> => {
  const candidateHash = await hashAccessKey(candidate, secret);
  return constantTimeEquals(candidateHash, storedHash);
};

export const createSessionToken = async (
  payload: ProjectSessionPayload,
  secret: string
): Promise<string> => {
  const serializedPayload = JSON.stringify(payload);
  const encodedPayload = encodeText(serializedPayload);
  const signature = await signBytes(encodedPayload, secret);
  return `${toBase64Url(encodedPayload)}.${toBase64Url(signature)}`;
};

export const parseSessionToken = async (
  token: string,
  secret: string
): Promise<ProjectSessionPayload | null> => {
  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature) return null;

  const payloadBytes = fromBase64Url(encodedPayload);
  const expectedSignature = await signBytes(payloadBytes, secret);
  if (!constantTimeEquals(toBase64Url(expectedSignature), encodedSignature)) {
    return null;
  }

  const payload = JSON.parse(decodeText(payloadBytes)) as ProjectSessionPayload;
  return payload;
};
