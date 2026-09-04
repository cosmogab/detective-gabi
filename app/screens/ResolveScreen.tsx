import { LiveResolution } from '@/app/components/live/LiveResolution'
import { Shell } from './Shell'

/**
 * Which company is this name?
 *
 * Its own parameter, because it is its own question (D54): nothing is investigated here and no
 * provider is called — the answer is an identity, or a request for one.
 */
export function ResolveScreen(props: { query: string }) {
  return (
    <Shell defaultQuery={props.query}>
      <LiveResolution query={props.query} />
    </Shell>
  )
}
