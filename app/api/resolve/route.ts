/**
 * Company name in, candidates out. Wikidata search plus Tavily when a key is available.
 *
 * Fetches, then hands the candidates to `decideResolution` in `lib/resolve.ts`, which is
 * where the judgement — one clear winner, or hand the choice back — is made and tested.
 */
export async function POST(request: Request): Promise<Response> {
  throw new Error('not implemented')
}
