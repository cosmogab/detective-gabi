import type { LogEvent } from '@/lib/types'

/**
 * The loading state is this log. Events render as they arrive, are kept rather than cleared,
 * fold under the report when the stream closes, and failures stay visible in red.
 */
export function InvestigationLog(props: { events: readonly LogEvent[]; folded?: boolean }) {
  throw new Error('not implemented')
}
