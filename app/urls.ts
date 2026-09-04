import type { Found } from '@/lib/resolve'
import { isPublisherDomain } from '@/lib/resolve'

/**
 * The URLs this app writes, and the identity each one carries.
 *
 * It sits beside `page.tsx` rather than in `lib/` because it is the router's own vocabulary:
 * these are the three parameters D54 gave three meanings to, and the page that reads them is
 * one file away. It lived in `CandidateGrid.tsx` before, which meant a server page imported a
 * function from a component module to build a link.
 */

/**
 * The one URL that means "investigate this now", and `refresh` is what makes it go past
 * whatever is stored. Moved here from `app/page.tsx` so the server page and the candidate
 * cards write the same grammar rather than two copies of it.
 *
 * The identifiers resolution won ride in it. They are public identifiers, not secrets, and
 * carrying them is what makes the link reproduce the report instead of a poorer one: without
 * the LEI, GLEIF falls back to searching by name, finds every record that shares it and
 * identifies none of them. A link that quietly answers a worse question than the one that
 * produced it would be its own small dishonesty, so the identity travels with the URL (D56).
 */
export function investigateHref(
  name: string,
  domain: string | null,
  options: {
    refresh?: boolean
    wikidataId?: string
    lei?: string
    cik?: string
    country?: string
  } = {},
): string {
  const params = new URLSearchParams({ investigate: name })
  if (domain !== null && domain !== '') params.set('domain', domain)
  if (options.refresh === true) params.set('refresh', '1')
  if (options.wikidataId !== undefined) params.set('wikidataId', options.wikidataId)
  if (options.lei !== undefined) params.set('lei', options.lei)
  if (options.country !== undefined) params.set('country', options.country)
  if (options.cik !== undefined) params.set('cik', options.cik)
  return `/?${params.toString()}`
}

/** The URL that means "work out which company this name is". Its own parameter (D54). */
export function resolveHref(query: string): string {
  return `/?${new URLSearchParams({ resolve: query }).toString()}`
}

/**
 * Where choosing this candidate would lead.
 *
 * A publisher's host is dropped: it identifies the page which mentioned the company, and
 * handing it on as the company's own domain would key an entire report to somebody else's
 * address. Such a candidate is investigated by name alone, which is all it actually gave us.
 */
export function identityOf(entry: Found): {
  name: string
  domain: string | null
  wikidataId?: string
  lei?: string
  cik?: string
  // Declared, because it is returned. Left out, it still reached the URL — spread properties
  // escape excess-property checking — and was invisible to everything downstream, which is how
  // it came to be dropped at the request that needed it (T50).
  country?: string
} {
  // A publisher stated a page, not a company: neither its host nor any identifier beside it
  // describes the company, so only the name survives.
  if (isPublisherDomain(entry.candidate)) return { name: entry.input.name, domain: null }
  const { name, domain, wikidataId, lei, cik, country } = entry.input
  return {
    name,
    domain,
    ...(wikidataId === undefined ? {} : { wikidataId }),
    ...(lei === undefined ? {} : { lei }),
    ...(country === undefined ? {} : { country }),
    ...(cik === undefined ? {} : { cik }),
  }
}

/** The URL that identity leads to. One rule, so the link and the run cannot start apart. */
export function targetFor(entry: Found): string {
  const { name, domain, ...identifiers } = identityOf(entry)
  return investigateHref(name, domain, identifiers)
}

/**
 * The candidates paired with the action each one offers, in the order they were returned.
 *
 * An action is offered only when it distinguishes this candidate from every other card on
 * screen. Two cards that would open the same investigation are not two choices, and a button
 * on each would promise a difference the data does not have — so both lose the button and keep
 * only what actually separates them, which in that case is nothing.
 *
 * Neither card is removed. A candidate is labelled, never hidden: hiding one would be choosing
 * on the reader's behalf, which is the whole thing an ambiguous verdict refuses to do.
 */
export function withActions(found: readonly Found[]): { entry: Found; href: string | null }[] {
  const targets = found.map(targetFor)
  return found.map((entry, index) => {
    const target = targets[index]
    const shared = targets.filter((other) => other === target).length > 1
    return { entry, href: target === undefined || shared ? null : target }
  })
}
