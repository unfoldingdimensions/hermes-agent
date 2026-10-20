/**
 * The session rail — a narrow column beside the conversation describing the
 * focused session: its context, its environment, what changed, what's running
 * in the background, and which servers/connectors are live.
 *
 * The rail is ONE pane in the layout tree (see `app/contrib/layout-presets.ts`),
 * so the tree's own machinery — docking, collapsing, flipping, presets — applies
 * to it unchanged. What lives here is the pane BODY: the card stack and the
 * per-card visibility menu.
 *
 * Every card reads an existing store (see `cards.tsx`); the rail adds no new
 * source of truth for any fact it shows.
 */

import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { $activeProfile } from '@/store/profile'

import {
  $hiddenRailCards,
  loadHiddenCards,
  SESSION_RAIL_CARDS,
  type SessionRailCardId,
  toggleRailCard,
  visibleRailCards
} from './card-visibility'
import { renderRailCard } from './cards'
import { refreshRail } from './refresh'

/**
 * The profile whose hidden-card set the rail edits. Card visibility is
 * profile-scoped: the rail describes one profile's session, and one profile's
 * pruning should not silently reorder another's.
 */
function useRailProfile(): string {
  return useStore($activeProfile)
}

/**
 * The "which cards?" menu. A rail is narrow, so the control is a small text
 * button in the rail's own header rather than a per-card menu — one place to
 * see and change every card, no hunting.
 *
 * It uses the app's own dropdown primitive rather than a hand-rolled popover,
 * so it gets the same focus handling, keyboard navigation, positioning and
 * dismissal as every other menu in the desktop app.
 */
function CardVisibilityMenu({ profile }: { profile: string }) {
  const { t } = useI18n()
  const copy = t.sessionRail
  const hidden = useStore($hiddenRailCards)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 text-[0.6875rem] hover:bg-accent"
          data-slot="session-rail-cards-button"
          type="button"
        >
          {copy.configureCards}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        {SESSION_RAIL_CARDS.map(cardId => (
          <DropdownMenuCheckboxItem
            checked={!hidden.has(cardId)}
            data-slot="session-rail-cards-menu-item"
            key={cardId}
            onCheckedChange={() => toggleRailCard(cardId, profile)}
            onSelect={event => event.preventDefault()}
          >
            {copy.cards[cardId].title}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The pane body. Cards render in the fixed display order; a hidden card takes
 * no space at all (it is not rendered), so the column stays exactly as tall as
 * its visible cards — no dead space, no placeholder rows.
 */
export function SessionRailPane() {
  const { t } = useI18n()
  const copy = t.sessionRail
  const profile = useRailProfile()
  const hidden = useStore($hiddenRailCards)

  useEffect(() => {
    loadHiddenCards(profile)
  }, [profile])

  const visible = useMemo(() => visibleRailCards(hidden), [hidden])

  return (
    <div className="bg-background flex h-full min-h-0 flex-col" data-slot="session-rail">
      <div className="border-border/60 flex h-8 shrink-0 items-center gap-1 border-b px-3">
        <span className="text-muted-foreground text-[0.6875rem] font-medium tracking-wide uppercase">
          {copy.title}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            aria-label={copy.refresh}
            className="text-muted-foreground hover:text-foreground rounded px-1 py-0.5 hover:bg-accent"
            data-slot="session-rail-refresh"
            onClick={refreshRail}
            title={copy.refresh}
            type="button"
          >
            <Codicon name="refresh" size="0.8125rem" />
          </button>
          <CardVisibilityMenu profile={profile} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-muted-foreground/80 px-3 py-4 text-[0.75rem]">{copy.noCards}</p>
        ) : (
          visible.map(cardId => <RailCard cardId={cardId} key={cardId} />)
        )}
      </div>
    </div>
  )
}

function RailCard({ cardId }: { cardId: SessionRailCardId }) {
  return renderRailCard(cardId)
}
