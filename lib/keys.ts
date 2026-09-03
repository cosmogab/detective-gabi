import type { Source } from '@/lib/types'

/** Keys supplied by the user for this request. Never persisted server-side, never logged. */
export type UserKeys = Partial<Record<Source, string>>

/** user-supplied > environment default > none. */
export function resolveKey(
  id: Source,
  userKeys: UserKeys,
  env?: NodeJS.ProcessEnv,
): string | null {
  throw new Error('not implemented')
}

/**
 * Builds the `key` function carried by `Ctx`. A function rather than a bag of resolved keys,
 * so a context can be inspected or serialised without a key surfacing — see decision D16.
 */
export function keyResolver(
  userKeys: UserKeys,
  env?: NodeJS.ProcessEnv,
): (id: Source) => string | null {
  throw new Error('not implemented')
}
