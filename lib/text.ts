/**
 * The string work every module was doing for itself: comparing two spellings of one name,
 * reading a registry that shouts, and counting a thing in words.
 *
 * Four copies of the legal-form list, three implementations of the name comparison and two of
 * the accent fold. D53 and D65 recorded two of those copies as deliberate, and both gave the
 * same reason: another lane owned the file. No lane does now (D91).
 */

/**
 * Dropped from the *end* of a name before two names are compared, never from the middle.
 *
 * "SHOPIFY INC." and "Shopify" are the same company written twice; "Shopify International
 * Limited" is a different one, which is why only a trailing form goes and only while a word
 * would be left behind.
 */
export const LEGAL_FORMS: readonly string[] = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co', 'limited', 'ltd', 'llc', 'lp',
  'llp', 'plc', 'nv', 'bv', 'ag', 'gmbh', 'sa', 'sas', 'sarl', 'srl', 'spa', 'ab', 'as', 'oy',
  'pty', 'pte', 'kk',
]

function withoutLegalForm(words: string[]): string {
  while (words.length > 1 && LEGAL_FORMS.includes(words[words.length - 1] as string)) words.pop()
  return words.join(' ')
}

/**
 * The key two *stated* names are compared on: case dropped, dots and commas opened out, a
 * trailing legal form removed. "Fly.io" and "fly.io" are one company; "Acme Corp" is nobody's
 * alias.
 *
 * Only `.` and `,` go, and that is the whole difference from `looseNameKey`: `&` is part of a
 * legal name. A registry publishes "AT&T Inc." and means the ampersand, so a comparison that
 * dissolved it would be comparing something the source never wrote.
 */
export function nameKey(name: string): string {
  return withoutLegalForm(
    name
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .split(/\s+/)
      .filter((word) => word !== ''),
  )
}

/**
 * The key a *typed* name is compared on: everything that is not a letter or a digit becomes a
 * space.
 *
 * Someone searching for a company is not quoting its registration. They type "at t", "at&t" or
 * "AT & T" and mean one thing, so here the punctuation is noise. That makes this key strictly
 * looser than `nameKey`, and the two disagree about `AT&T` on purpose: collapsing them into one
 * function would be deciding that in silence, in whichever direction the survivor happened to
 * take.
 */
export function looseNameKey(name: string): string {
  return withoutLegalForm(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((word) => word !== ''),
  )
}

/**
 * Registries shout. A city in capitals is a formatting choice of the filing system, not how
 * the place is written — but text that is not all capitals is left exactly as the source
 * published it, because then the capitals are the source's meaning.
 */
export function titleCase(text: string): string {
  if (text !== text.toUpperCase()) return text
  return text
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, edge: string, letter: string) => edge + letter.toUpperCase())
}

/**
 * Accents removed, spacing collapsed, case dropped: the form two spellings of one word share.
 *
 * Used where the thing compared is a person's name or a country's, not a company's — there is
 * no legal form to strip, and "Genève" must meet "Geneve".
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * A count and its noun, agreeing. Written out at seven call sites before this, each one a
 * ternary inside a template string.
 */
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
