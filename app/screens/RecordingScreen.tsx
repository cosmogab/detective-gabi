import { StoredAnswer } from '@/app/components/case/Banners'
import { CaseFile } from '@/app/components/case/CaseFile'
import { investigateHref } from '@/app/urls'
import { type FixtureName, fixtureReport } from '@/lib/providers/fake'
import { Shell } from './Shell'

/**
 * A committed recording, opened.
 *
 * The screen and the data have to agree: a report served from disk is not one we just fetched,
 * and `Report` already carries the fields that say so. T17 renders the same two fields for a
 * TTL cache hit.
 */
export function RecordingScreen(props: { found: FixtureName; asked: string }) {
  const captured = fixtureReport(props.found)
  const recording = { ...captured, cached: true, cachedAt: captured.fetchedAt }

  return (
    <Shell defaultQuery={props.asked}>
      {/* The same line a cache hit gets. A stored answer shown without saying so would be
          the same fault as an invented value: the page would be claiming an investigation
          that did not happen. */}
      <StoredAnswer
        kind="Recording"
        obtainedAt={recording.cachedAt ?? recording.fetchedAt}
        // `refresh`, because the gesture is leaving a stored answer for a live one. Without it
        // a fresh-enough entry in the TTL cache is served instead — a different stored answer
        // to the one question the reader pressed a button to stop being given.
        href={investigateHref(recording.company.name, recording.company.domain, {
          refresh: true,
        })}
      />
      <CaseFile report={recording} />
    </Shell>
  )
}
