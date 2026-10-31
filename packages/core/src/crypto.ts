import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'seotools', 'settings-encryption', 32))
}

/** AES-256-GCM. Output: `v1:<base64(iv | authTag | ciphertext)>`. */
export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`
}

export function decryptString(payload: string, secret: string): string {
  const [version, body] = payload.split(':')
  if (version !== VERSION || !body) throw new Error('Unsupported encrypted payload format')
  const raw = Buffer.from(body, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error(
      'Could not decrypt value: SETTINGS_ENCRYPTION_KEY / BETTER_AUTH_SECRET changed since it was saved',
    )
  }
}
