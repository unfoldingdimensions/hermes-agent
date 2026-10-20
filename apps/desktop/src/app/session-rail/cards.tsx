/**
 * The session rail's cards.
 *
 * Each card reads ONE existing store or API — nothing here fetches state the
 * app already knows. The rail is a VIEW over the app's existing surfaces, so
 * adding a card must never add a second source of truth for the same fact.
 *
 * Every card renders the same shell (header + body) so the column reads as one
 * stack rather than six unrelated widgets: equal padding, one type scale, and a
 * hairline between cards instead of a box around each.
 */

import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { getCronJobs } from '@/api/cron'
import { listMcpServers } from '@/api/mcp'
import { getMessagingPlatforms } from '@/api/messaging'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import { useContextBreakdown } from '@/app/shell/hooks/use-context-breakdown'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $repoStatus, $repoWorktrees } from '@/store/coding-status'
import { $focusedRuntimeId, $focusedWorkspaceCwd } from '@/store/session-states'
import { $subagentsBySession } from '@/store/subagents'

import type { SessionRailCardId } from './card-visibility'

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

interface CardShellProps {
  cardId: SessionRailCardId
  children: React.ReactNode
  /** Right-aligned header content — a count, a badge, a status word. */
  trailing?: React.ReactNode
}

/**
 * One card. Cards are separated by a hairline rather than each being boxed, so
 * the column reads as one stack instead of six floating widgets.
 */
function CardShell({ cardId, children, trailing }: CardShellProps) {
  const { t } = useI18n()
  const copy = t.sessionRail

  return (
    <section
      className="border-border/60 border-b last:border-b-0"
      data-card={cardId}
      data-slot="session-rail-card"
    >
      <header className="text-muted-foreground flex h-7 items-center gap-2 px-3 text-[0.6875rem] font-medium tracking-wide uppercase">
        <span className="truncate">{copy.cards[cardId].title}</span>
        {trailing ? <span className="ml-auto shrink-0 tabular-nums">{trailing}</span> : null}
      </header>
      <div className="px-3 pb-3 text-[0.75rem]">{children}</div>
    </section>
  )
}

/** The "nothing here" line — a card with no data says so rather than shrinking. */
function EmptyRow({ label }: { label: string }) {
  return <p className="text-muted-foreground/80 text-[0.75rem]">{label}</p>
}

/** A label/value row inside a card body. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="min-w-0 truncate text-right tabular-nums">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function ContextCard() {
  const { t } = useI18n()
  const copy = t.sessionRail.cards.context

  // The app's own context panel already has every category label translated
  // in every locale, so the rail reuses them instead of shipping a second
  // set that could drift. The backend also sends a localized label per
  // category, so a missing branch degrades to that rather than crashing —
  // a card must never take the whole rail down.
  const categoryLabels = (
    t as unknown as {
      shell?: { statusbar?: { contextUsagePanel?: { categories?: Record<string, string> } } }
    }
  ).shell?.statusbar?.contextUsagePanel?.categories

  const sessionId = useStore($focusedRuntimeId)
  const { requestGateway } = useGatewayRequest()

  // The SAME hook the statusbar gauge uses, so the rail and the gauge can never
  // disagree about the same session's occupancy.
  const { breakdown, loading, reason } = useContextBreakdown({
    busy: false,
    enabled: true,
    requestGateway,
    sessionId
  })

  if (!breakdown) {
    // The empty state has to be TRUE. A stored conversation that has not been
    // resumed into a live agent has no context to measure — but saying "No
    // context yet" about a 122-message session is a lie the user can see
    // through. The hook now says which of the two it is.
    const label = loading
      ? copy.loading
      : reason === 'no-session' || reason === 'zeroed'
        ? copy.notLoaded
        : reason === 'error'
          ? copy.unavailable
          : copy.empty

    return (
      <CardShell cardId="context" trailing={loading ? <GlyphSpinner ariaLabel={copy.loading} /> : null}>
        <EmptyRow label={label} />
      </CardShell>
    )
  }

  const percent = Math.max(0, Math.min(100, Math.round(breakdown.context_percent ?? 0)))
  const used = breakdown.context_used ?? 0
  const max = breakdown.context_max ?? 0

  return (
    <CardShell
      cardId="context"
      trailing={<span className="text-muted-foreground/90 tabular-nums">{percent}%</span>}
    >
      <div className="bg-muted/40 mb-2 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full', percent > 85 ? 'bg-destructive' : 'bg-foreground/60')}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* The absolute figure the percentage is computed from. Without it the
          card shows a share of a window the reader cannot see the size of, and
          the rows below look like they should add up to it — they do not,
          because these are the PROMPT's composition, not the whole context. */}
      <Row
        label={copy.used}
        value={
          <span className="text-foreground">
            {breakdown.context_estimated ? '~' : ''}
            {compactNumber(used)}
            {max ? ` / ${compactNumber(max)}` : ''}
          </span>
        }
      />

      {/* EVERY category, not the first few. The transcript is the largest
          one by far and it is the last in the backend's display order, so
          truncating the list hid the very number that explains the gap. Each
          row is a local chars/4 estimate of the PROMPT's composition, so it
          is marked `~` — the app's own context panel marks them the same way.
          The rows sum to `estimated_total`, which is close to but not equal
          to the provider-measured total above. */}
      {breakdown.categories.map(category => (
        <Row
          key={category.id}
          label={categoryLabels?.[category.id] ?? category.label}
          value={`~${compactNumber(category.tokens)}`}
        />
      ))}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function EnvironmentCard() {
  const { t } = useI18n()
  const copy = t.sessionRail.cards.environment
  const cwd = useStore($focusedWorkspaceCwd)
  const repoStatus = useStore($repoStatus)
  const worktrees = useStore($repoWorktrees)

  const folder = cwd ? cwd.split(/[\\/]+/).filter(Boolean).pop() : ''

  if (!cwd) {
    return (
      <CardShell cardId="environment">
        <EmptyRow label={copy.empty} />
      </CardShell>
    )
  }

  return (
    <CardShell cardId="environment">
      <Row label={copy.folder} value={<span title={cwd}>{folder}</span>} />
      {repoStatus?.branch ? <Row label={copy.branch} value={repoStatus.branch} /> : null}
      {repoStatus ? (
        <Row
          label={copy.sync}
          value={
            repoStatus.ahead > 0 || repoStatus.behind > 0
              ? `${repoStatus.ahead}↑ ${repoStatus.behind}↓`
              : copy.inSync
          }
        />
      ) : null}
      {worktrees.length > 0 ? <Row label={copy.worktrees} value={worktrees.length} /> : null}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function ChangesCard() {
  const { t } = useI18n()
  const copy = t.sessionRail.cards.changes
  const repoStatus = useStore($repoStatus)

  if (!repoStatus || repoStatus.changed === 0) {
    return (
      <CardShell cardId="changes">
        <EmptyRow label={copy.clean} />
      </CardShell>
    )
  }

  return (
    <CardShell cardId="changes" trailing={<span className="text-muted-foreground/90 tabular-nums">{repoStatus.changed}</span>}>
      {repoStatus.staged > 0 ? <Row label={copy.staged} value={repoStatus.staged} /> : null}
      {repoStatus.unstaged > 0 ? <Row label={copy.unstaged} value={repoStatus.unstaged} /> : null}
      {repoStatus.untracked > 0 ? <Row label={copy.untracked} value={repoStatus.untracked} /> : null}
      {repoStatus.conflicted > 0 ? <Row label={copy.conflicted} value={repoStatus.conflicted} /> : null}
      {repoStatus.added > 0 || repoStatus.removed > 0 ? (
        <Row
          label={copy.lines}
          value={
            <>
              <span className="text-emerald-600/90 dark:text-emerald-400/90">+{repoStatus.added}</span>{' '}
              <span className="text-destructive/90">−{repoStatus.removed}</span>
            </>
          }
        />
      ) : null}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function BackgroundCard() {
  const { t } = useI18n()
  const copy = t.sessionRail.cards.background
  const sessionId = useStore($focusedRuntimeId)
  const bySession = useStore($subagentsBySession)
  const [cronCount, setCronCount] = useState<null | number>(null)

  const subagents = sessionId ? (bySession[sessionId] ?? []) : []
  const running = subagents.filter(subagent => subagent.status === 'running' || subagent.status === 'queued')

  useEffect(() => {
    let cancelled = false
    getCronJobs()
      .then(jobs => {
        if (!cancelled) {
          setCronCount(jobs.filter(job => job.enabled).length)
        }
      })
      .catch(() => {
        // A failed fetch leaves the count unknown rather than showing zero,
        // which would read as "no scheduled jobs" when it means "didn't load".
        if (!cancelled) {
          setCronCount(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (running.length === 0 && cronCount === null) {
    return (
      <CardShell cardId="background">
        <EmptyRow label={copy.empty} />
      </CardShell>
    )
  }

  return (
    <CardShell
      cardId="background"
      trailing={
        running.length > 0 ? (
          <span className="text-muted-foreground/90 tabular-nums">{running.length}</span>
        ) : null
      }
    >
      {running.length > 0 ? (
        <>
          {running.slice(0, 4).map(subagent => (
            <Row key={subagent.id} label={subagent.goal} value={copy.running} />
          ))}
          {running.length > 4 ? <Row label={copy.more} value={running.length - 4} /> : null}
        </>
      ) : null}
      {cronCount !== null && cronCount > 0 ? <Row label={copy.scheduled} value={cronCount} /> : null}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

function ServersCard() {
  const { t } = useI18n()
  const copy = t.sessionRail.cards.servers
  const [servers, setServers] = useState<null | { name: string; enabled: boolean; tools: string[] | null }[]>(null)

  useEffect(() => {
    let cancelled = false
    listMcpServers()
      .then(result => {
        if (!cancelled) {
          setServers(result.servers)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServers(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (servers === null) {
    return (
      <CardShell cardId="servers" trailing={<GlyphSpinner ariaLabel={copy.loading} />}>
        <EmptyRow label={copy.loading} />
      </CardShell>
    )
  }

  if (servers.length === 0) {
    return (
      <CardShell cardId="servers">
        <EmptyRow label={copy.empty} />
      </CardShell>
    )
  }

  const enabled = servers.filter(server => server.enabled)

  return (
    <CardShell cardId="servers" trailing={<span className="text-muted-foreground/90 tabular-nums">{enabled.length}</span>}>
      {enabled.slice(0, 6).map(server => (
        <Row key={server.name} label={server.name} value={server.tools?.length ?? ''} />
      ))}
      {enabled.length > 6 ? <Row label={t.sessionRail.cards.servers.more} value={enabled.length - 6} /> : null}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

function ConnectorsCard() {
  const { t } = useI18n()
  const copy = t.sessionRail.cards.connectors
  const [platforms, setPlatforms] = useState<null | { id: string; configured: boolean; enabled: boolean }[]>(null)

  useEffect(() => {
    let cancelled = false
    getMessagingPlatforms()
      .then(result => {
        if (!cancelled) {
          setPlatforms(result.platforms)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlatforms(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (platforms === null) {
    return (
      <CardShell cardId="connectors" trailing={<GlyphSpinner ariaLabel={copy.loading} />}>
        <EmptyRow label={copy.loading} />
      </CardShell>
    )
  }

  const connected = platforms.filter(platform => platform.configured)

  if (connected.length === 0) {
    return (
      <CardShell cardId="connectors">
        <EmptyRow label={copy.empty} />
      </CardShell>
    )
  }

  return (
    <CardShell
      cardId="connectors"
      trailing={<span className="text-muted-foreground/90 tabular-nums">{connected.length}</span>}
    >
      {connected.slice(0, 6).map(platform => (
        <Row key={platform.id} label={platform.id} value={platform.enabled ? copy.on : copy.off} />
      ))}
    </CardShell>
  )
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const CARD_COMPONENTS: Record<SessionRailCardId, () => React.JSX.Element> = {
  background: BackgroundCard,
  changes: ChangesCard,
  connectors: ConnectorsCard,
  context: ContextCard,
  environment: EnvironmentCard,
  servers: ServersCard
}

export { CardShell, EmptyRow, Row }

export function renderRailCard(cardId: SessionRailCardId): React.JSX.Element {
  const Component = CARD_COMPONENTS[cardId]

  return <Component />
}
