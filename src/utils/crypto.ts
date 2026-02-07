/**
 * Simple encryption utilities for local API key storage.
 * Uses AES-GCM via Web Crypto API with a derived key.
 *
 * This is NOT meant to be unbreakable encryption — it is an obfuscation
 * layer that prevents casual plaintext exposure of API keys in localStorage.
 */

// A fixed salt for key derivation (this is NOT a secret — it just ensures
// consistent key derivation. The real protection is that the encrypted data
// is harder to extract than plaintext).
const SALT = new Uint8Array([
  87, 114, 105, 116, 101, 66, 111, 116, 75, 101, 121, 83, 97, 108, 116, 33,
]);

// Derive from a fixed application identifier
const KEY_MATERIAL = "WriteBot-LocalEncryption-v1";

async function deriveKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(KEY_MATERIAL),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptString(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  try {
    const key = await deriveKey();
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plaintext)
    );
    // Combine IV + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return "enc:" + btoa(String.fromCharCode(...combined));
  } catch {
    // Fallback: return plaintext if encryption fails
    return plaintext;
  }
}

export async function decryptString(data: string): Promise<string> {
  if (!data) return "";
  // If not encrypted (no "enc:" prefix), return as-is (backward compatible)
  if (!data.startsWith("enc:")) return data;
  try {
    const key = await deriveKey();
    const raw = Uint8Array.from(atob(data.slice(4)), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const ciphertext = raw.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // If decryption fails, return empty (key may have been corrupted)
    return "";
  }
}
