import type { FakeFailure } from '@/lib/providers/fake'
import type { Provider } from '@/lib/providers/types'

/**
 * The failure states that can be forced for demonstration, per SPEC §7. Defined once, in
 * `fake.ts`: the demo and the tests must not be able to drift into different failure sets.
 */
export type DemoMode = FakeFailure

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
