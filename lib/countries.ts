/**
 * ISO 3166-1 alpha-2, read out of the runtime's own region data rather than a table written
 * from memory.
 *
 * Two providers built this for themselves. EDGAR read one display style and keyed on the
 * lowercased name; Abstract read three, folded accents and punctuation, understood
 * "Myanmar (Burma)" as two names for one place, and refused the four CLDR regions that are not
 * countries. D65 recorded the copy as deliberate — a change made for EDGAR's descriptions must
 * not silently move Abstract's companies — and named the lane rule as the reason. No lane owns
 * either file now (D91), so this is the wider of the two tables, shared, with EDGAR's
 * recordings standing as the proof that it still answers what EDGAR needs.
 */

/**
 * CLDR names a few things "regions" that ISO 3166-1 does not assign to a country. They are
 * listed because a company cannot be headquartered in one, and because leaving them in would
 * let a source place a company in "the European Union".
 */
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO'])

/**
 * Alternate English names for countries the runtime spells differently.
 *
 * This list is not a map of the world and does not pretend to be one — the world comes from
 * ICU below. It holds the names a data source is likely to write that CLDR does not produce:
 * the ISO 3166 official forms ("Viet Nam", "Republic of Korea"), and the former or informal
 * names that outlived the rename ("Czech Republic", "Turkey", "Swaziland"). Measured against
 * the real provider before being written here — "Czechia" resolved and "Czech Republic" did
 * not, which is the spelling a company API actually uses.
 *
 * Every entry is dropped unless the runtime knows the code it points at, so this can add a
 * spelling and never a country. And a name that is in neither place is reported in the log
 * rather than passed off as an unknown location.
 */
const ALSO_KNOWN_AS: ReadonlyArray<readonly [string, string]> = [
  ['czech republic', 'CZ'],
  ['turkey', 'TR'],
  ['ivory coast', 'CI'],
  ['cabo verde', 'CV'],
  ['swaziland', 'SZ'],
  ['macedonia', 'MK'],
  ['east timor', 'TL'],
  ['holy see', 'VA'],
  ['vatican', 'VA'],
  ['united states of america', 'US'],
  ['usa', 'US'],
  ['great britain', 'GB'],
  ['uae', 'AE'],
  ['democratic republic of the congo', 'CD'],
  ['dr congo', 'CD'],
  ['republic of the congo', 'CG'],
  ['russian federation', 'RU'],
  ['republic of korea', 'KR'],
  ['korea republic of', 'KR'],
  ['democratic peoples republic of korea', 'KP'],
  ['viet nam', 'VN'],
  ['syrian arab republic', 'SY'],
  ['lao peoples democratic republic', 'LA'],
  ['brunei darussalam', 'BN'],
  ['iran islamic republic of', 'IR'],
  ['bolivia plurinational state of', 'BO'],
  ['venezuela bolivarian republic of', 'VE'],
  ['tanzania united republic of', 'TZ'],
  ['moldova republic of', 'MD'],
  ['micronesia federated states of', 'FM'],
  ['palestine state of', 'PS'],
  ['taiwan province of china', 'TW'],
  ['macau', 'MO'],
]

/**
 * One comparable form for a country name, so spellings that differ only in presentation meet.
 * Accents, punctuation and case go; "&" becomes "and"; "St." becomes "Saint", which is a
 * dozen countries in one rule; "the" is dropped wherever it falls.
 */
function comparableName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .flatMap((word) => (word === 'the' ? [] : [word === 'st' ? 'saint' : word]))
    .join(' ')
}

/** "Myanmar (Burma)" is two names for one place, and a source will write either. */
function spellings(name: string): string[] {
  const parenthesised = /^(.*?)\s*\((.*?)\)\s*$/.exec(name)
  return parenthesised === null ? [name] : [name, parenthesised[1] ?? '', parenthesised[2] ?? '']
}

type Countries = { byName: Map<string, string>; codes: Set<string> }

/**
 * The countries ISO 3166-1 assigns, read out of the runtime's own region data rather than a
 * table written from memory — and one table, so the codes we accept from a source are exactly
 * the codes we can produce ourselves.
 *
 * A code has to survive three checks the runtime answers. It must have a name of its own, which
 * excludes every unassigned pair such as "XX". It must not canonicalise to a different code,
 * which is how a withdrawn one like "UK" or "SU" is caught. And it must survive `maximize()`,
 * which is what separates a place from "ZZ", the code CLDR names "Unknown Region" and would
 * otherwise have let a source put a company nowhere.
 *
 * The middle check is deliberately kept though `maximize()` happens to catch withdrawn codes
 * as well — measured, and a mutation of it survives the suite. It states the rule D35 settled
 * for EDGAR: a missing country is survivable, a wrong one is not. Removing it would leave that
 * rule resting on a side effect of the third check.
 *
 * All three display styles are read, because the short form is a name a source will write:
 * "Hong Kong" is the short name and "Hong Kong SAR China" the long one.
 */
let resolved: Countries | null = null
function countries(): Countries {
  if (resolved !== null) return resolved
  const display = (['long', 'short', 'narrow'] as const).map(
    (style) => new Intl.DisplayNames(['en'], { type: 'region', style }),
  )
  const byName = new Map<string, string>()
  const codes = new Set<string>()

  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second)
      if (NOT_A_COUNTRY.has(code)) continue
      const locale = new Intl.Locale(`und-${code}`)
      if (locale.region !== code || locale.maximize().region !== code) continue
      const names = display
        .map((style) => style.of(code))
        .filter((name): name is string => name !== undefined && name !== code)
      if (names.length === 0) continue

      codes.add(code)
      for (const name of names) {
        for (const spelling of spellings(name)) {
          const key = comparableName(spelling)
          // The long name wins a collision, and an alias never overwrites a real one.
          if (key !== '' && !byName.has(key)) byName.set(key, code)
        }
      }
    }
  }

  for (const [name, code] of ALSO_KNOWN_AS) {
    // An alias can add a spelling for a country the runtime knows. It can never add a country.
    if (codes.has(code)) byName.set(comparableName(name), code)
  }

  resolved = { byName, codes }
  return resolved
}

/**
 * The country a name refers to, or nothing. Never a guess, and never a shape: a name the
 * runtime does not know yields null, because a missing country is survivable and a wrong one
 * is not (D35).
 */
export function countryCode(name: string): string | null {
  const key = comparableName(name)
  return key === '' ? null : (countries().byName.get(key) ?? null)
}

/**
 * Whether ISO actually assigns this code, checked against the codes we can produce ourselves
 * rather than against a shape. Measured: Abstract answers `country_iso_code: "UK"` beside
 * `country: "United Kingdom"`, and "UK" is not an ISO code — GB is. A shape test kept "UK" and
 * skipped the name that would have resolved correctly.
 */
export function isCountryCode(code: string): boolean {
  return countries().codes.has(code)
}
