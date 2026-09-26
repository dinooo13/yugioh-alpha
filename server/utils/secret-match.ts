import { createHash, timingSafeEqual } from 'node:crypto'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Compares a submitted secret with the configured one in constant time
 * (both sides are hashed first, so their lengths don't leak either).
 * A missing, non-string or empty submission never matches.
 */
export function secretMatches(submitted: unknown, expected: string): boolean {
  if (typeof submitted !== 'string' || !submitted || !expected) {
    return false
  }
  return timingSafeEqual(digest(submitted), digest(expected))
}
