// Envinity client-side cryptography (Web Crypto API). Runs in the browser and in Node 20+.
//
// What the server never sees:
//   * the password            -> only `authKey` (PBKDF2 -> HKDF "auth") is sent, and the server scrypts it again
//   * the vault key           -> HKDF "vault" from the same PBKDF2 output, kept in memory only
//   * any ticket key K        -> sent only wrapped (by the vault key, or by a key derived from the share code)
//   * the share code          -> only SHA-256(code) is sent, for lookup
//   * the .env contents       -> AES-256-GCM ciphertext only
//
// QR links put K in the URL fragment (#...), which browsers never send to a server.

const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()
const dec = new TextDecoder()

export const ACCOUNT_KDF_ITERATIONS = 600_000 // OWASP guidance for PBKDF2-HMAC-SHA256
export const CODE_KDF_ITERATIONS = 300_000
const TICKET_AAD = enc.encode('envinity-ticket-v1')
const OWNER_WRAP_AAD = enc.encode('envinity-owner-wrap-v1')
const CODE_WRAP_AAD = enc.encode('envinity-code-wrap-v1')
const OWNER_CODE_AAD = enc.encode('envinity-owner-code-v1')

// ---------- encoding ----------
export function toB64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))

async function sha256Hex(text) {
  const digest = new Uint8Array(await subtle.digest('SHA-256', enc.encode(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- account keys ----------
export const newKdfSalt = () => toB64u(randomBytes(16))

/**
 * password -> PBKDF2(600k) -> 256-bit master -> HKDF -> { authKey (sent to server), vaultKey (never leaves) }.
 * Deterministic for the same password + salt, so any device can re-derive both.
 */
export async function deriveAccountKeys(password, saltB64u, iterations = ACCOUNT_KDF_ITERATIONS) {
  const pwKey = await subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  const master = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(saltB64u), iterations }, pwKey, 256)
  const hkdf = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const authBits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('envinity-auth') }, hkdf, 256)
  const vaultKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('envinity-vault') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: scripts cannot read the raw vault key out of memory via export
    ['encrypt', 'decrypt'],
  )
  return { authKey: toB64u(authBits), vaultKey }
}

// ---------- share codes ----------
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

/** 8 characters from a 31-symbol alphabet, rejection-sampled so there is no modulo bias. */
export function generateShareCode() {
  const out = []
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < 248 && out.length < 8) out.push(CODE_ALPHABET[b % 31]) // 248 = 31 * 8
    }
  }
  return `${out.slice(0, 4).join('')}-${out.slice(4).join('')}`
}

export function normaliseCode(input) {
  const raw = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

/** What the server stores (after its own HMAC) to find a ticket by code. */
export const codeLookup = (code) => sha256Hex(`envinity-code:${normaliseCode(code)}`)

async function codeKey(code, saltB64u, iterations) {
  const base = await subtle.importKey('raw', enc.encode(normaliseCode(code)), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(saltB64u), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---------- tickets ----------
async function aesEncrypt(key, data, aad) {
  const iv = randomBytes(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data)
  return { ct: toB64u(ct), iv: toB64u(iv) }
}

async function aesDecrypt(key, ctB64u, ivB64u, aad) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(ivB64u), additionalData: aad }, key, fromB64u(ctB64u)))
}

const importTicketKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

/**
 * Encrypts parsed vars into a ticket. Returns the API body plus the share code
 * and the raw ticket key (for the QR fragment). Nothing secret is in `body`.
 */
export async function sealTicket({ vars, vaultKey, name, environment, oneTime, keepForever }) {
  const k = randomBytes(32)
  const ticketKey = await importTicketKey(k)
  const payload = enc.encode(JSON.stringify({ v: 1, vars }))
  const sealed = await aesEncrypt(ticketKey, payload, TICKET_AAD)
  const ownerWrap = await aesEncrypt(vaultKey, k, OWNER_WRAP_AAD)

  const code = generateShareCode()
  const salt = newKdfSalt()
  const codeWrap = await aesEncrypt(await codeKey(code, salt, CODE_KDF_ITERATIONS), k, CODE_WRAP_AAD)
  const ownerCode = await aesEncrypt(vaultKey, enc.encode(code), OWNER_CODE_AAD)

  return {
    code,
    ticketKey: toB64u(k),
    body: {
      name,
      environment,
      varCount: vars.length,
      ciphertext: sealed.ct,
      iv: sealed.iv,
      ownerWrappedKey: ownerWrap.ct,
      ownerWrapIv: ownerWrap.iv,
      code: { lookup: await codeLookup(code), salt, iterations: CODE_KDF_ITERATIONS, wrappedKey: codeWrap.ct, wrapIv: codeWrap.iv },
      ownerCode: { ct: ownerCode.ct, iv: ownerCode.iv },
      oneTime,
      keepForever,
    },
  }
}

async function openPayload(kRaw, ciphertext, iv) {
  const bytes = await aesDecrypt(await importTicketKey(kRaw), ciphertext, iv, TICKET_AAD)
  const parsed = JSON.parse(dec.decode(bytes))
  if (parsed?.v !== 1 || !Array.isArray(parsed.vars)) throw new Error('Unsupported ticket format')
  return parsed.vars
}

/** Owner view: unwrap K (and the share code) with the vault key, for re-showing the QR and code. */
export async function openAsOwner(t, vaultKey) {
  const k = await aesDecrypt(vaultKey, t.ownerWrappedKey, t.ownerWrapIv, OWNER_WRAP_AAD)
  const code = t.ownerCodeEnc ? dec.decode(await aesDecrypt(vaultKey, t.ownerCodeEnc, t.ownerCodeIv, OWNER_CODE_AAD)) : null
  return { vars: await openPayload(k, t.ciphertext, t.iv), ticketKey: toB64u(k), code }
}

/** Recipient with a share code. The server only returned ciphertext + the code-wrapped key. */
export async function openWithCode(code, res) {
  const key = await codeKey(code, res.code.salt, res.code.iterations)
  const k = await aesDecrypt(key, res.code.wrappedKey, res.code.wrapIv, CODE_WRAP_AAD)
  return openPayload(k, res.ciphertext, res.iv)
}

/** Recipient with a QR link: K came from the URL fragment. */
export async function openWithKey(ticketKeyB64u, res) {
  return openPayload(fromB64u(ticketKeyB64u), res.ciphertext, res.iv)
}
