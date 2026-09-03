import type { Report } from '@/lib/types'

/**
 * TTL cache keyed by domain. In-memory, backed by `/tmp` locally.
 *
 * On Vercel the filesystem is ephemeral, so this is a quota guard and a warm-instance speed
 * win, not persistence — see decision D5. `now` is passed in so the TTL can be tested without
 * touching the clock.
 */
export function readCache(domain: string, now: number): Report | null {
  throw new Error('not implemented')
}

export function writeCache(domain: string, report: Report, now: number): void {
  throw new Error('not implemented')
}

/** Drops every entry. For tests, and for an explicit refresh. */
export function clearCache(): void {
  throw new Error('not implemented')
}
