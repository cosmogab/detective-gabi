import { LiveInvestigation } from '@/app/components/live/LiveInvestigation'
import { investigateHref } from '@/app/urls'
import { Masthead, Shell } from './Shell'

/** What resolution settled, carried into the run it starts. */
export type Identity = { wikidataId?: string; lei?: string; country?: string; cik?: string }

/**
 * An investigation, running. An explicit action, so no URL ever means both "investigate this
 * now" and "reopen the recording of it".
 *
 * The masthead is handed *into* `LiveInvestigation` rather than rendered above it, which is
 * why this screen is the one that asks `Shell` not to draw one: the wait takes the screen, and
 * the field has to sit inside the layout the wait owns.
 */
export function InvestigateScreen(props: {
  target: string
  asked: string
  domain: string | null
  refresh: boolean
  /**
   * Forwarded as typed. The route is what decides whether it names a failure state, and an
   * unrecognised value simply is not one — it is never an error (SPEC §7).
   */
  demo: string
  identity: Identity
}) {
  const { target, asked, domain, refresh, demo, identity } = props
  return (
    <Shell masthead={false}>
      <LiveInvestigation
        masthead={<Masthead defaultQuery={asked} />}
        name={target}
        domain={domain}
        refresh={refresh}
        demo={demo}
        identity={identity}
        // Deliberately without `demo`: from a simulated report this link is the way back to
        // a real investigation, which is the same gesture as refreshing a stored one. The
        // identity is kept, because refreshing asks the same question of the same company.
        refreshHref={investigateHref(target, domain, { refresh: true, ...identity })}
      />
    </Shell>
  )
}
