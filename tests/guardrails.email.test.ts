import { describe, expect, it } from 'vitest'
import { peopleFromHunter } from '@/lib/providers/hunter'

// Guardrail 2, written before lib/providers/hunter.ts exists. Turns green in T14.
// Owner: lane A3.
//
// The shape was confirmed against `test-api-key` in T14: every field these payloads read
// exists in the live response under the same name, and a real recording now sits in
// `fixtures/raw/hunter/`. Two things here the development key cannot produce, and which are
// therefore constructed rather than recorded: a verification status other than `valid`, and
// an `emails` entry with no address at all. The second is defensive — Domain Search returns
// addresses it has seen — and it is the case that says what happens to the `pattern` beside it.

const NOW = '2026-09-03T10:00:00.000Z'

/** An executive Hunter did not verify, on a domain whose address pattern is known. */
const unverified = {
  data: {
    domain: 'example.com',
    pattern: '{first}.{last}',
    organization: 'Example',
    emails: [
      {
        value: 'jane.doe@example.com',
        type: 'personal',
        confidence: 41,
        first_name: 'Jane',
        last_name: 'Doe',
        position: 'Chief Executive Officer',
        seniority: 'executive',
        department: 'executive',
        sources: [],
        verification: { date: null, status: null },
      },
    ],
  },
}

/** An executive whose address Hunter reports as actually verified. */
const verified = {
  data: {
    domain: 'example.com',
    pattern: '{first}',
    organization: 'Example',
    emails: [
      {
        value: 'ada@example.com',
        type: 'personal',
        confidence: 97,
        first_name: 'Ada',
        last_name: 'Lovelace',
        position: 'Chief Technology Officer',
        seniority: 'executive',
        department: 'executive',
        sources: [{ uri: 'https://example.com/team', extracted_on: '2026-01-04' }],
        verification: { date: '2026-02-01', status: 'valid' },
      },
    ],
  },
}

/** An executive with a title but no address at all, on a domain with a known pattern. */
const nameOnly = {
  data: {
    domain: 'example.com',
    pattern: '{first}.{last}',
    organization: 'Example',
    emails: [
      {
        value: null,
        type: 'personal',
        confidence: 0,
        first_name: 'Grace',
        last_name: 'Hopper',
        position: 'Chief Operating Officer',
        seniority: 'executive',
        department: 'executive',
        sources: [],
        verification: { date: null, status: null },
      },
    ],
  },
}

describe('guardrail 2 — a pattern-derived email is never marked verified', () => {
  it('does not mark an unverified address as verified', () => {
    const people = peopleFromHunter(unverified, { fetchedAt: NOW })

    for (const person of people) {
      expect(person.email?.status).not.toBe('verified')
    }
  })

  it('never fabricates a verified address from the domain pattern alone', () => {
    // Applying "{first}.{last}" to Grace Hopper would produce a plausible address.
    // It may be offered as an unverified pattern, or not offered at all. Never as verified.
    const people = peopleFromHunter(nameOnly, { fetchedAt: NOW })

    for (const person of people) {
      if (person.email !== null) {
        expect(person.email.status).toBe('unverified-pattern')
      }
    }
  })

  it('does mark a genuinely verified address as verified', () => {
    // The positive control: without it, always returning 'unverified-pattern' would pass
    // the two tests above while making the verified badge meaningless.
    const people = peopleFromHunter(verified, { fetchedAt: NOW })

    expect(people).toHaveLength(1)
    expect(people[0]?.email?.address).toBe('ada@example.com')
    expect(people[0]?.email?.status).toBe('verified')
  })
})
