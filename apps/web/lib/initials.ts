/** Up to two uppercase initials for an avatar fallback: "Ada Lovelace" → "AL". */
export function getInitials(name: string, email?: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = (words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1))
    .map((word) => Array.from(word ?? '')[0] ?? '')
    .join('')
  return (letters || Array.from(email?.trim() ?? '')[0] || '?').toUpperCase()
}
