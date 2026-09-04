import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Home from '@/app/page'
import { FIXTURE_NAMES, fixtureReport } from '@/lib/providers/fake'
import type { FixtureName } from '@/lib/providers/fake'

/**
 * The home page: what the first screen holds, and whether the explanation under it is true.
 *
 * The second half is the one that matters. `How it works` makes four claims about four
 * recordings, and D29 says this section may only describe things a reader can go and check. A
 * prose test would prove the sentence is on the page; these prove the sentence is *right*, by
 * reading the recording it links to. If a fixture is ever recaptured and Nvidia's head office
 * stops coming from EDGAR, the page becomes wrong and this fails — which is the only way a claim
 * about data stays honest as the data moves.
 */

async function home(params: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await Home({ searchParams: Promise.resolve(params) }))
}

/** The first `<section>`: everything the lamp can find before the light goes on. */
function firstScreen(html: string): string {
  const open = html.indexOf('<section')
  return html.slice(open, html.indexOf('<section', open + 1))
}

describe('the first screen', () => {
  it('holds a title, a subtitle and a field', async () => {
    const screen = firstScreen(await home())
    expect(screen).toContain('Detective Gabi')
    expect(screen).toContain('Company research, with its sources.')
    expect(screen.match(/<form/g)).toHaveLength(1)
  })

  it('holds nothing else', async () => {
    const screen = firstScreen(await home())
    // No link, so nothing to click but the field: no example cards, no keys, no explanation.
    expect(screen).not.toContain('<a ')
    expect(screen).not.toContain('<h2')
    for (const word of ['How it works', 'on record', 'Your keys']) {
      expect(screen).not.toContain(word)
    }
  })

  it('does not deny a search that it is about to run', async () => {
    // `No search ran` described a field that refused. It does not refuse any more, so the
    // denial has nothing left to deny — a name that is not on record goes to resolution.
    const html = await home()
    expect(html).not.toContain('No search ran')

    const miss = home({ q: 'Airbnb' })
    await expect(miss).rejects.toMatchObject({ digest: expect.stringContaining('resolve=Airbnb') })
  })
})

describe('every recording is offered once, and only inside the rule it proves', () => {
  it('links each company to its own case file, exactly once on the page', async () => {
    const html = await home()
    for (const name of FIXTURE_NAMES) {
      const report = fixtureReport(name)
      const company = report.company.name
      expect(html.split(`>${company}</a>`)).toHaveLength(2)
      expect(html).toContain(`href="/?domain=${report.company.domain}"`)
    }
  })
})

describe('the explanation is true of the recordings it points at', () => {
  const report = (name: FixtureName) => fixtureReport(name)

  it('Nvidia: the ranking is applied field by field', async () => {
    const nvidia = report('nvidia')
    // The claim on the page. EDGAR outranks Wikidata, and it won only the field it holds.
    expect(nvidia.fields.location.found && nvidia.fields.location.source).toBe('edgar')
    expect(nvidia.fields.yearFounded.found && nvidia.fields.yearFounded.source).toBe('wikidata')
    expect(nvidia.fields.employees.found && nvidia.fields.employees.source).toBe('wikidata')
    expect(await home()).toContain('the head office comes from SEC EDGAR')
  })

  it('Stripe: the two sources really do disagree, and both are kept', async () => {
    const location = report('stripe').fields.location
    expect(location.found).toBe(true)
    if (!location.found) return
    expect(location.source).toBe('gleif')
    expect(location.value.formatted).toContain('South San Francisco')
    expect(location.conflicts.map((held) => held.source)).toContain('wikidata')
    expect(location.conflicts.some((held) => held.value.formatted.startsWith('San Francisco'))).toBe(
      true,
    )
  })

  it('Shopify: the headcount carries the date the source gave it', async () => {
    const employees = report('shopify').fields.employees
    expect(employees.found).toBe(true)
    if (!employees.found) return
    expect(employees.value).toBe(8300)
    expect(employees.asOf).toBe('2023')
    expect(await home()).toContain('8,300 employees, as of 2023')
  })

  it('Fly.io: nothing was found, and every source named was actually checked', async () => {
    const flyio = report('flyio')
    expect(flyio.fields.location.found).toBe(false)
    expect(flyio.fields.employees.found).toBe(false)
    if (flyio.fields.location.found) return
    // The page names three registries. Naming one that was not consulted would be the exact
    // invention `sourcesChecked` exists to prevent (D46).
    for (const source of ['edgar', 'gleif', 'wikidata'] as const) {
      expect(flyio.fields.location.sourcesChecked).toContain(source)
    }
  })

  it('claims no email, because no recording holds one', async () => {
    // The two rules with no company beside them are the two nothing on record can demonstrate.
    for (const name of FIXTURE_NAMES) {
      for (const person of fixtureReport(name).people.found) {
        expect(person.email).toBeNull()
      }
    }
  })
})
