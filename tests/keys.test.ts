import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type Environment,
  keyHeaderName,
  keyResolver,
  resolveKey,
  type UserKeys,
  userKeysFrom,
} from '@/lib/keys'
import { hunter } from '@/lib/providers/hunter'
import type { Ctx } from '@/lib/providers/types'
import type { Source } from '@/lib/types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** An environment with nothing configured, which is the state the app must work in. */
const NOTHING: Environment = {}

describe('user-supplied beats the environment beats nothing', () => {
  it('prefers the key the user supplied for this request', () => {
    const env = { HUNTER_API_KEY: 'from-the-environment' }

    expect(resolveKey('hunter', { hunter: 'from-the-user' }, env)).toBe('from-the-user')
  })

  it('falls back to the environment when the user supplied none', () => {
    expect(resolveKey('hunter', {}, { HUNTER_API_KEY: 'from-the-environment' })).toBe(
      'from-the-environment',
    )
  })

  it('answers nothing when neither tier holds one', () => {
    expect(resolveKey('hunter', {}, NOTHING)).toBeNull()
  })

  it('keeps the tiers separate per source', () => {
    const env = { HUNTER_API_KEY: 'hunter-env', TAVILY_API_KEY: 'tavily-env' }
    const resolve = keyResolver({ hunter: 'hunter-user' }, env)

    expect(resolve('hunter')).toBe('hunter-user')
    expect(resolve('web')).toBe('tavily-env')
    expect(resolve('wikidata')).toBeNull()
  })
})

describe('a blank is not a key', () => {
  it('does not count an emptied environment variable as a key', () => {
    // `.env.example` ships `ABSTRACT_API_KEY=` with no value, so an unconfigured deployment
    // holds "" rather than undefined. Counted as a key it would send an empty credential and
    // turn an honest "no key available" into a fabricated 401.
    expect(resolveKey('abstract', {}, { ABSTRACT_API_KEY: '' })).toBeNull()
  })

  it('does not count whitespace as a key', () => {
    expect(resolveKey('hunter', {}, { HUNTER_API_KEY: '   \n' })).toBeNull()
    expect(resolveKey('hunter', { hunter: '\t' }, NOTHING)).toBeNull()
  })

  it('survives a supplied value that is not a string at all', () => {
    // `resolveKey` is public and its `userKeys` need not have come from `userKeysFrom`. A
    // route parsing a JSON body would hand over whatever was in it, and `.trim()` on a number
    // throws — losing the whole request rather than one key.
    const junk = { hunter: 42, web: null } as unknown as UserKeys

    expect(resolveKey('hunter', junk, { HUNTER_API_KEY: 'real' })).toBe('real')
    expect(resolveKey('web', junk, NOTHING)).toBeNull()
  })

  it('lets the environment answer when what the user pasted is not usable', () => {
    // The state they were in before pasting it, rather than a source lost to a typo.
    expect(resolveKey('hunter', { hunter: '  ' }, { HUNTER_API_KEY: 'real' })).toBe('real')
  })
})

describe('what leaves this module can be put in a header', () => {
  it('trims a key on the way out', () => {
    // A value out of an env file or a paste carries a newline, and `fetch` rejects an invalid
    // header value by quoting it back inside the error it throws.
    expect(resolveKey('hunter', { hunter: '  sk-live-4a9f\n' }, NOTHING)).toBe('sk-live-4a9f')
    expect(resolveKey('hunter', {}, { HUNTER_API_KEY: '\nsk-env-1\n' })).toBe('sk-env-1')
  })

  it('refuses a value carrying a control character rather than sending it', () => {
    // Trimming settles the ends; this is the middle. For EDGAR the value goes into
    // `User-Agent`, where a newline is header injection and not a formatting problem.
    expect(resolveKey('hunter', { hunter: 'sk-live\n4a9f' }, NOTHING)).toBeNull()
    expect(resolveKey('edgar', { edgar: 'Me me@example.com\r\nX-Injected: 1' }, NOTHING)).toBeNull()
  })

  it('keeps a key that merely looks unusual', () => {
    // Base64 and its padding, and an internal space, are all legal in a header value.
    expect(resolveKey('hunter', { hunter: 'a+b/c=' }, NOTHING)).toBe('a+b/c=')
    expect(resolveKey('edgar', { edgar: 'Detective Gabi me@example.com' }, NOTHING)).toBe(
      'Detective Gabi me@example.com',
    )
  })
})

describe('the environment is injected, not reached for', () => {
  it('reads the environment it was given and not the process', () => {
    vi.stubEnv('HUNTER_API_KEY', 'the-process-key')

    expect(resolveKey('hunter', {}, NOTHING)).toBeNull()
  })

  it('falls back to the process environment when none is given', () => {
    // The default the routes actually use, so it is exercised rather than assumed.
    vi.stubEnv('HUNTER_API_KEY', 'the-process-key')

    expect(resolveKey('hunter', {})).toBe('the-process-key')
    expect(keyResolver({})('hunter')).toBe('the-process-key')
  })
})

describe('the variable each source reads', () => {
  const TABLE: ReadonlyArray<[Source, string]> = [
    ['abstract', 'ABSTRACT_API_KEY'],
    ['hunter', 'HUNTER_API_KEY'],
    ['web', 'TAVILY_API_KEY'],
    ['llm', 'GEMINI_API_KEY'],
    ['edgar', 'EDGAR_USER_AGENT'],
  ]

  it.each(TABLE)('reads %s from %s', (id, variable) => {
    expect(resolveKey(id, {}, { [variable]: 'configured' })).toBe('configured')
  })

  it('does not invent a variable name from the source id', () => {
    // `web` is served by Tavily and `llm` by Gemini. `${id}_API_KEY` would name variables
    // nobody sets, and a lookup that silently misses looks exactly like an unconfigured one.
    expect(resolveKey('web', {}, { WEB_API_KEY: 'configured' })).toBeNull()
    expect(resolveKey('llm', {}, { LLM_API_KEY: 'configured' })).toBeNull()
  })

  it('answers nothing for a source no variable configures', () => {
    for (const id of ['wikidata', 'gleif', 'website'] as Source[]) {
      expect(resolveKey(id, {}, { WIKIDATA_API_KEY: 'x', GLEIF_API_KEY: 'x' })).toBeNull()
    }
  })

  it('names only variables .env.example publishes', () => {
    // The drift detector: renaming a variable in one place and not the other loses a key
    // silently, and the report would say the source was never configured.
    const published = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

    for (const [, variable] of TABLE) {
      expect(published).toContain(`${variable}=`)
    }
  })
})

describe('one header per source, carrying nothing but the value', () => {
  it('reads a key off the request header for that source', () => {
    const headers = new Headers({ 'x-dg-key-hunter': 'sk-user', 'x-dg-key-web': 'tvly-user' })

    expect(userKeysFrom(headers)).toEqual({ hunter: 'sk-user', web: 'tvly-user' })
  })

  it('spells the header name in exactly one place', () => {
    const headers = new Headers({ [keyHeaderName('abstract')]: 'ab-user' })

    expect(keyHeaderName('abstract')).toBe('x-dg-key-abstract')
    expect(userKeysFrom(headers).abstract).toBe('ab-user')
  })

  it('ignores a header for a source nothing configures', () => {
    const headers = new Headers({ 'x-dg-key-wikidata': 'nowhere-to-send-this' })

    expect(userKeysFrom(headers)).toEqual({})
  })

  it('reads the header whatever case it arrives in', () => {
    // HTTP header names are case-insensitive and a client is free to spell one however it
    // likes, so this must not depend on the spelling in `keyHeaderName`.
    const headers = new Headers({ 'X-DG-Key-Hunter': 'sk-user' })

    expect(userKeysFrom(headers).hunter).toBe('sk-user')
  })

  it('finds no keys in a request that carries none', () => {
    expect(userKeysFrom(new Headers())).toEqual({})
  })

  it('does not read the JSON header the other route ships', () => {
    // The convention this module serves. Two of them shipped in parallel; reading both would
    // keep both alive, and a key lost to the wrong header name is a source reported as
    // unconfigured when the user configured it.
    const headers = new Headers({ 'x-detective-keys': JSON.stringify({ hunter: 'sk-user' }) })

    expect(userKeysFrom(headers)).toEqual({})
  })

  it('carries a key through the header to the resolver', () => {
    const request = new Request('https://example.com', {
      headers: { [keyHeaderName('hunter')]: '  sk-user  ' },
    })

    expect(keyResolver(userKeysFrom(request.headers), NOTHING)('hunter')).toBe('sk-user')
  })
})

describe('a key cannot be got out of a context', () => {
  const SECRET = 'sk-live-do-not-print-me'

  function context(): Ctx {
    return {
      key: keyResolver({ hunter: SECRET }, { TAVILY_API_KEY: 'tvly-also-secret' }),
      signal: new AbortController().signal,
      now: '2026-09-04T10:00:00.000Z',
      allowKeyedProviders: true,
    }
  }

  it('serialises without revealing one', () => {
    // D16: `key` is a function precisely so the obvious thing to log cannot leak.
    const ctx = context()

    expect(JSON.stringify(ctx)).not.toContain(SECRET)
    expect(JSON.stringify(ctx)).not.toContain('tvly-also-secret')
    expect(ctx.key('hunter')).toBe(SECRET)
  })

  it('does not reveal one to an inspector either', () => {
    // What a crash reporter or a console.log actually prints, which JSON.stringify is not.
    const printed = inspect(context(), { depth: null, showHidden: true, getters: true })

    expect(printed).not.toContain(SECRET)
    expect(printed).not.toContain('tvly-also-secret')
  })

  it('holds no key on any property, however reached', () => {
    const ctx = context()
    const reachable = [
      ...Object.values(ctx),
      ...Object.getOwnPropertyNames(ctx),
      ...Object.values(Object.getOwnPropertyDescriptors(ctx)),
    ]

    expect(JSON.stringify(reachable)).not.toContain(SECRET)
  })

  it('keeps a key out of the log a real provider writes', async () => {
    // The composition nobody owns: the resolver hands a provider a key, the provider fails,
    // and the failure is displayed. What `fetch` does with an unusable header value is quote
    // it back, so this is the shape of the accident rather than an invented one.
    vi.stubGlobal('fetch', async () => {
      throw new Error(`Headers.append: "${SECRET}" is an invalid header value`)
    })

    const result = await hunter.run({ name: 'Example', domain: 'example.com' }, context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'request failed' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})
