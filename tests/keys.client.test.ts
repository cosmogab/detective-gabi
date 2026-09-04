import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeysModal } from '@/app/components/KeysModal'
import {
  KEYED_SOURCES,
  clearKey,
  isSendable,
  keyHeaders,
  readStoredKeys,
  requestHeaders,
  storeKey,
} from '@/app/components/keys-storage'
import { keyHeaderName, resolveKey, userKeysFrom } from '@/lib/keys'
import type { Source } from '@/lib/types'

/**
 * The reader's own key: where it is held, how it leaves, and what happens when the browser
 * refuses to hold anything at all.
 *
 * The two ends are tested together on purpose. The client writes a header and the route reads
 * one, and the only thing that makes those the same header is that both call `keyHeaderName`
 * — a fact worth a test rather than a convention worth trusting (D62).
 */

const KEY = 'abstract-live-9f2c41'

/** A `sessionStorage` that behaves, for the tab that has one. */
function workingStorage(): Storage {
  const held = new Map<string, string>()
  return {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => void held.set(k, v),
    removeItem: (k: string) => void held.delete(k),
    clear: () => held.clear(),
    key: (i: number) => [...held.keys()][i] ?? null,
    get length() {
      return held.size
    },
  }
}

/** A tab that refuses site data: reaching for the object throws, before any method is called. */
function refusingWindow(): unknown {
  return {
    get sessionStorage(): Storage {
      throw new Error('The operation is insecure.')
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: workingStorage() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a key entered reaches the header the route reads', () => {
  it('travels under the name lib/keys.ts spells, and arrives as itself', () => {
    expect(storeKey('abstract', KEY)).toBe(true)

    const headers = keyHeaders()
    expect(headers).toEqual({ [keyHeaderName('abstract')]: KEY })

    // The other end. Not "a header with the right name" — the value the route resolves.
    const supplied = userKeysFrom(new Headers(headers))
    expect(supplied.abstract).toBe(KEY)
    expect(resolveKey('abstract', supplied, {})).toBe(KEY)
  })

  it('beats the environment default, because it is the reader spending their own quota', () => {
    storeKey('abstract', KEY)
    const supplied = userKeysFrom(new Headers(keyHeaders()))

    expect(resolveKey('abstract', supplied, { ABSTRACT_API_KEY: 'ours' })).toBe(KEY)
  })

  it('sends nothing at all when nothing is stored', () => {
    expect(keyHeaders()).toEqual({})
    expect(resolveKey('abstract', userKeysFrom(new Headers(keyHeaders())), {})).toBeNull()
  })

  it('sends a header only for the source it was entered for', () => {
    storeKey('hunter', 'hunter-key')
    const headers = keyHeaders()

    expect(headers[keyHeaderName('hunter')]).toBe('hunter-key')
    expect(headers[keyHeaderName('abstract')]).toBeUndefined()
    expect(headers[keyHeaderName('web')]).toBeUndefined()
  })

  it('stops sending one that was forgotten', () => {
    storeKey('abstract', KEY)
    clearKey('abstract')

    expect(keyHeaders()).toEqual({})
    expect(readStoredKeys().abstract).toBeUndefined()
  })

  it('offers a key only for a source something actually consults', () => {
    const offered = KEYED_SOURCES.map(({ id }) => id)

    expect(offered).toEqual(['abstract', 'hunter', 'web'])
    // Gemini is configurable in lib/keys.ts and consumed by nothing, so it is not offered:
    // a field that stores a value nothing sends is a promise the app does not keep.
    expect(offered).not.toContain('llm')
  })
})

describe('a value that cannot be a header value never becomes one', () => {
  it('refuses to store one, rather than letting fetch quote it back in an error', () => {
    // `fetch` rejects an invalid header value by printing it inside the error it throws, and
    // that error is how a key reaches a log line. So it is stopped here.
    expect(storeKey('abstract', 'has a\nnewline')).toBe(false)
    expect(storeKey('abstract', '   ')).toBe(false)
    expect(keyHeaders()).toEqual({})
  })

  it('accepts an ordinary key, spaces trimmed', () => {
    expect(isSendable(`  ${KEY}  `)).toBe(true)
    expect(storeKey('abstract', `  ${KEY}  `)).toBe(true)
    expect(keyHeaders()[keyHeaderName('abstract')]).toBe(KEY)
  })
})

describe('a tab that will not hold anything', () => {
  beforeEach(() => {
    vi.stubGlobal('window', refusingWindow())
  })

  it('reads nothing rather than throwing', () => {
    // Reaching for the object is what throws here, before any method is called — a private
    // window, or a browser told to block site data.
    expect(() => readStoredKeys()).not.toThrow()
    expect(readStoredKeys()).toEqual({})
    expect(keyHeaders()).toEqual({})
  })

  it('reports a failure to store instead of pretending it worked', () => {
    expect(storeKey('abstract', KEY)).toBe(false)
    expect(() => clearKey('abstract')).not.toThrow()
  })

  it('still renders the modal, with every source shown as having no key', () => {
    const html = renderToStaticMarkup(
      createElement(KeysModal, { open: true, onClose: () => {} }),
    )

    expect(html).toContain('Your keys')
    for (const { label } of KEYED_SOURCES) expect(html).toContain(label)
    expect(html).toContain('no key')
    expect(html).not.toContain('key stored')
  })
})

describe('a stored key is never rendered back into the page', () => {
  it('keeps it out of the markup even when one is stored', () => {
    storeKey('abstract', KEY)
    const html = renderToStaticMarkup(
      createElement(KeysModal, { open: true, onClose: () => {} }),
    )

    // The field starts empty every time and the status line is the only thing that knows.
    // Nothing can put the value in a screenshot, in the DOM, or in server-rendered HTML.
    expect(html).not.toContain(KEY)
  })

  it('renders nothing at all while closed', () => {
    expect(renderToStaticMarkup(createElement(KeysModal, { open: false, onClose: () => {} }))).toBe('')
  })
})

describe('the header name is spelled once', () => {
  it('is the same string on both ends for every source offered', () => {
    for (const { id } of KEYED_SOURCES) {
      const name: string = keyHeaderName(id)
      // Read back through the route's own reader rather than compared to a literal: a literal
      // here would be a third spelling of the thing this test exists to keep single.
      const supplied = userKeysFrom(new Headers({ [name]: 'value' }))
      expect(supplied[id satisfies Source]).toBe('value')
    }
  })
})

describe('the key actually leaves the browser', () => {
  it('rides on the headers a request carries, beside the content type', () => {
    storeKey('abstract', KEY)

    expect(requestHeaders()).toEqual({
      'content-type': 'application/json',
      [keyHeaderName('abstract')]: KEY,
    })
  })

  it('leaves the request unchanged when the reader has supplied nothing', () => {
    expect(requestHeaders()).toEqual({ 'content-type': 'application/json' })
  })

  /**
   * A source-level check, because the failure it guards against is one this repo has shipped
   * four times: something built, tested in isolation, and never called. There is no DOM here
   * to run an effect in, so what is asserted is that both live components hand their fetch the
   * headers rather than writing their own — which is the only way a key reaches the route.
   */
  it('is what both live components give their fetch', async () => {
    const { readFileSync } = await import('node:fs')

    for (const module of ['LiveInvestigation', 'LiveResolution']) {
      const source = readFileSync(`app/components/live/${module}.tsx`, 'utf8')

      expect(source, module).toContain("from '../keys-storage'")
      expect(source, module).toContain('headers: requestHeaders(),')
      // Not a hand-written header bag beside it, which is how the keys would be dropped.
      expect(source, module).not.toContain("headers: { 'content-type'")
    }
  })
})

describe('a key never travels any way but the header', () => {
  it('is absent from the body a request sends', async () => {
    const { readFileSync } = await import('node:fs')
    storeKey('abstract', KEY)

    for (const module of ['LiveInvestigation', 'LiveResolution']) {
      const source = readFileSync(`app/components/live/${module}.tsx`, 'utf8')
      const start = source.indexOf('body: JSON.stringify(')
      const body = source.slice(start, source.indexOf('signal:', start))

      expect(start, module).toBeGreaterThan(-1)
      // The body is built from the query and the identity, and knows nothing about keys.
      expect(body.toLowerCase(), module).not.toContain('key')
    }
  })
})
