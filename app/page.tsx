import { CaseFile } from '@/app/components/CaseFile'
import { FIXTURE_NAMES, fixtureReport, type FixtureName } from '@/lib/providers/fake'

/**
 * T7 renders the report from the committed recordings alone — no provider, no route, no
 * fetch. T8 replaces this page with the real home page and its search field; until then the
 * query string is the only switch, and the strip of names below is how the four are read.
 */
function requestedFixture(value: string | string[] | undefined): FixtureName {
  return FIXTURE_NAMES.find((name) => name === value) ?? 'stripe'
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const name = requestedFixture((await searchParams).fixture)

  return (
    <main>
      <nav className="mx-auto flex max-w-case flex-wrap items-baseline gap-x-4 gap-y-2 px-6 pt-8">
        <span className="label text-faint">Fixtures</span>
        {FIXTURE_NAMES.map((fixture) => (
          <a
            key={fixture}
            href={`/?fixture=${fixture}`}
            aria-current={fixture === name ? 'page' : undefined}
            className={
              fixture === name
                ? 'font-mono text-xs text-ink underline underline-offset-4'
                : 'font-mono text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-ink'
            }
          >
            {fixture}
          </a>
        ))}
      </nav>
      <CaseFile report={fixtureReport(name)} />
    </main>
  )
}
