/** The largest icon kept. Real favicons are a few KB; a multi-size `.ico` rarely passes 100 KB. */
export const MAX_FAVICON_BYTES = 128 * 1024

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const SVG_START = /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

const startsWith = (bytes: Buffer, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte)

/**
 * The image type of some bytes, judged by the bytes themselves: servers label icons wrongly all
 * the time (`.ico` files served as `text/html` or `image/png`), and an error page answering with
 * 200 must never end up stored as an icon. `null` when it is none of the formats a browser shows
 * in an `<img>` and a favicon realistically uses.
 */
export function sniffImage(bytes: Buffer): string | null {
  if (startsWith(bytes, PNG)) return 'image/png'
  // ICO: reserved 0, type 1, then a non-zero image count.
  if (bytes.length >= 6 && startsWith(bytes, [0, 0, 1, 0]) && bytes.readUInt16LE(4) > 0) {
    return 'image/x-icon'
  }
  const head = bytes.subarray(0, 12).toString('latin1')
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  const text = bytes.subarray(0, 2048).toString('utf8')
  if (SVG_START.test(text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text)) {
    return 'image/svg+xml'
  }
  return null
}
