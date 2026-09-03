import type { Provider } from '@/lib/providers/types'

/** The failure states that can be forced for demonstration, per SPEC §7. */
export type DemoMode = 'quota-exhausted' | 'not-found' | 'timeout'

/** Reads `?demo=`. Anything unrecognised is null rather than an error. */
export function parseDemoMode(value: string | null | undefined): DemoMode | null {
  throw new Error('not implemented')
}

/**
 * The fake providers from `lib/providers/fake.ts`, wired to fail in the requested way.
 * The same fakes the unit tests use, so a demonstrated failure is a real one — and any
 * report built from these must carry `simulated: true`.
 */
export function demoProviders(mode: DemoMode): readonly Provider[] {
  throw new Error('not implemented')
}
