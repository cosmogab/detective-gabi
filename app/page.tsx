import { redirect } from 'next/navigation'
import { investigateHref, resolveHref } from '@/app/urls'
import { fixtureForDomain } from '@/lib/providers/fake'
import { domainTyped } from '@/lib/resolve'
import { HomeScreen } from './screens/HomeScreen'
import { InvestigateScreen } from './screens/InvestigateScreen'
import { RecordingScreen } from './screens/RecordingScreen'
import { ResolveScreen } from './screens/ResolveScreen'
import { onRecord } from './screens/recordings'

/**
 * Home and case file are one page, switched by the URL, so a report is shareable and
 * reloadable (SPEC §6).
 *
 * Three parameters, three meanings (D54). `?resolve=` works out which company a name is and
 * asks when it cannot tell. `?investigate=` runs a real investigation on an identity already
 * settled. `?q=` and `?domain=` open a committed recording, which is what the field's own
 * label promises.
 *
 * This file reads the parameters and picks a screen. Each screen is its own module under
 * `app/screens/`, because four screens in one component is four things a reader has to hold at
 * once to change any of them.
 */

function first(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? ''
  return ''
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  // The domain is the resolved identifier, so it wins when both are present (SPEC §6).
  const domain = first(params.domain)
  const query = first(params.q)
  const target = first(params.investigate)
  const resolving = first(params.resolve)
  // What a resolution settled, read back off the URL so a shared link investigates the same
  // identity the person who shared it saw, rather than a name search that lands elsewhere.
  const identity = {
    ...(first(params.wikidataId) === '' ? {} : { wikidataId: first(params.wikidataId) }),
    ...(first(params.lei) === '' ? {} : { lei: first(params.lei) }),
    ...(first(params.country) === '' ? {} : { country: first(params.country) }),
    ...(first(params.cik) === '' ? {} : { cik: first(params.cik) }),
  }
  const asked = domain !== '' ? domain : query
  const found = domain !== '' ? fixtureForDomain(domain.trim().toLowerCase()) : onRecord(query)

  // Its own parameter, because it is its own question: which company is this name? Nothing is
  // investigated here and no provider is called — the answer is an identity, or a request for
  // one (D54).
  //
  // Unless what was typed is already the answer. A domain is the identifier a report is keyed
  // on, so there is nothing left to identify and the field's own promise — "by name or domain"
  // — is kept here rather than by two searches that would drop the host on the way through.
  if (resolving !== '') {
    const typed = domainTyped(resolving)
    if (typed !== null) redirect(investigateHref(typed, typed))
    return <ResolveScreen query={resolving} />
  }

  // An explicit action, so no URL ever means both "investigate this now" and "reopen the
  // recording of it".
  if (target !== '') {
    return (
      <InvestigateScreen
        target={target}
        asked={asked}
        domain={domain === '' ? null : domain}
        refresh={first(params.refresh) !== ''}
        demo={first(params.demo)}
        identity={identity}
      />
    )
  }

  if (found !== null) return <RecordingScreen found={found} asked={asked} />

  // A name that is not on record is not a dead end. `No search ran` described a field that
  // refused; this one does not, so the denial has nothing left to deny and the name goes to the
  // question it was always asking: which company is this?
  if (asked !== '') redirect(resolveHref(asked))

  return <HomeScreen />
}
