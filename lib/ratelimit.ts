/**
 * Per-IP rate limit on the investigation route. The deployment is public and the default keys
 * are ours, so an open quota is an open wallet.
 *
 * Beyond the limit the request is not refused: keyed providers are skipped and the keyless
 * ones still run. The report says less rather than failing.
 */
export type RateLimitVerdict = {
  /** False only if we ever decide to refuse outright. Degrading is the normal path. */
  allowed: boolean
  /** Feeds `Ctx.allowKeyedProviders`. */
  keyedProvidersAllowed: boolean
  /** ISO 8601, when the caller's window resets. */
  resetsAt?: string
}

export function checkRateLimit(ip: string, now: number): RateLimitVerdict {
  throw new Error('not implemented')
}

/** Drops every counter. For tests. */
export function resetRateLimits(): void {
  throw new Error('not implemented')
}
