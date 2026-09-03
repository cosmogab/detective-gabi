import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Report } from '@/lib/types'

/**
 * Runs the registry, API and website groups in parallel and assembles the report.
 *
 * Providers are injected rather than imported, so the whole pipeline can be exercised with
 * fakes and no network. `onEvent` fires as each provider completes — every event is a real
 * completion, never a timer (decision D8).
 */
export async function investigate(
  input: ProviderInput,
  providers: readonly Provider[],
  ctx: Ctx,
  onEvent: (event: LogEvent) => void,
): Promise<Report> {
  throw new Error('not implemented')
}
