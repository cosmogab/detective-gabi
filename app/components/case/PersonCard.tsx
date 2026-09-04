import type { Person } from '@/lib/types'
import { CONFIDENCE, Provenance } from './FieldRow'
import { DOTTED } from '../ui/classes'

/**
 * A person of interest. The three email states are visually distinct: verified,
 * `unverified pattern`, or absent — never collapsed into one badge.
 *
 * A seen address and a pattern applied to a name are two different claims, so they get four
 * differences that survive greyscale: a filled badge against a hollow dashed one, the word
 * itself, a solid underline against a dotted one, and a `mailto:` the guess does not get —
 * offering to send mail to a guess is the affordance SPEC §8 refuses.
 */
// Not the `label` utility: that one uppercases, and `unverified pattern` is a specified
// literal that should read on screen exactly as the rule writes it.
const EMAIL_BADGE = 'px-1.5 py-0.5 font-sans text-meta tracking-label whitespace-nowrap'

export function PersonCard(props: { person: Person }) {
  const { person } = props
  const email = person.email
  const tone = CONFIDENCE[person.confidence]

  return (
    <li className={`${tone.rule} border-t border-t-rule py-4 pl-3`}>
      <p className={`answer ${tone.value}`}>{person.name}</p>
      {person.title !== null ? (
        <p className="mt-0.5 font-sans text-sm text-muted">{person.title}</p>
      ) : null}

      {/* A null email renders nothing at all. An empty slot would itself be a claim. */}
      {email !== null ? (
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {email.status === 'verified' ? (
            <>
              <a
                href={`mailto:${email.address}`}
                className="font-mono text-xs break-all text-ink underline underline-offset-2"
              >
                {email.address}
              </a>
              <span className={`${EMAIL_BADGE} border border-ink bg-ink text-paper`}>
                verified
              </span>
            </>
          ) : (
            <>
              <span className={`font-mono text-xs break-all text-muted ${DOTTED}`}>
                {email.address}
              </span>
              <span
                className={`${EMAIL_BADGE} border border-dashed border-rule-strong text-muted`}
              >
                unverified pattern
              </span>
            </>
          )}
        </p>
      ) : null}

      <p className="mt-1.5">
        <Provenance
          source={person.source}
          sourceUrl={person.sourceUrl}
          confidence={person.confidence}
        />
      </p>
    </li>
  )
}
