/**
 * Domain in, streamed `LogEvent`s out, then the assembled `Report`.
 *
 * POST rather than GET: the user's keys arrive as headers on a request that also carries a
 * body, and a key must never appear in a URL. Every external call in the investigation
 * happens here, server-side.
 */
export async function POST(request: Request): Promise<Response> {
  throw new Error('not implemented')
}
