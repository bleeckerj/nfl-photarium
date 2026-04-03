/**
 * Base64url helpers used for stateless session tokens.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encodeText = (value: string): Uint8Array => encoder.encode(value);

export const decodeText = (value: Uint8Array): string => decoder.decode(value);

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

