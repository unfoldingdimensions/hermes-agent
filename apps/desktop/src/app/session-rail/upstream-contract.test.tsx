/**
 * The rail's contract with the rest of the desktop app — the update tripwire.
 *
 * Every card reads an existing upstream store or hook, and the pane is registered
 * through the contrib registry, so a `hermes update` can break the rail WITHOUT
 * touching a single file under `session-rail/`. That is the dangerous failure
 * mode: the merge applies cleanly, the build passes, and the user finds an empty
 * column or a pane that never appears.
 *
 * This file names each upstream seam and asserts its SHAPE, so an upstream
 * refactor fails HERE — with a message that says which seam moved — instead of
 * silently in the running app.
 *
 * Placement and adoption are covered next door and are not duplicated here:
 *   - `app/contrib/layout-presets.test.ts`   — the rail is its own column
 *   - `app/contrib/session-rail-adoption.test.ts` — an existing saved layout
 *     re-homes the rail to the right of the workspace
 *
 * When this test fails after an update, fix the seam it names. Do not delete the
 * assertion: each one is a surface the rail cannot work without.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _resetContextBreakdownInvalidationsForTests,
  invalidateContextBreakdown,
  useContextBreakdown
} from '@/app/shell/hooks/use-context-breakdown'
import { en } from '@/i18n/en'
import { $repoStatus, $repoWorktrees } from '@/store/coding-status'
import {
  SESSION_RAIL_DEFAULT_WIDTH,
  SESSION_RAIL_MAX_WIDTH,
  SESSION_RAIL_MIN_WIDTH
} from '@/store/layout'
import { $activeProfile } from '@/store/profile'
import { $focusedRuntimeId, $focusedWorkspaceCwd } from '@/store/session-states'
import { $subagentsBySession } from '@/store/subagents'

import { SESSION_RAIL_CARDS } from './card-visibility'
import { $railRefreshTick, _resetRailRefreshForTests, refreshRail } from './refresh'

type AnyAtom = { get: () => unknown }

/** The stores every card reads. A rename or removal upstream is a rail outage. */
const STORES: Array<[string, AnyAtom]> = [
  ['@/store/session-states $focusedRuntimeId', $focusedRuntimeId as AnyAtom],
  ['@/store/session-states $focusedWorkspaceCwd', $focusedWorkspaceCwd as AnyAtom],
  ['@/store/coding-status $repoStatus', $repoStatus as AnyAtom],
  ['@/store/coding-status $repoWorktrees', $repoWorktrees as AnyAtom],
  ['@/store/subagents $subagentsBySession', $subagentsBySession as AnyAtom],
  ['@/store/profile $activeProfile', $activeProfile as AnyAtom]
]

beforeEach(() => {
  _resetRailRefreshForTests()
  _resetContextBreakdownInvalidationsForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('session rail ↔ upstream contract', () => {
  it('the context hook still returns the rail’s four fields', async () => {
    const requestGateway = vi.fn().mockResolvedValue({
      categories: [],
      context_max: 1_000_000,
      context_percent: 10,
      context_used: 100_000,
      estimated_total: 100_000
    })

    const { result } = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'contract' })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(Object.keys(result.current).sort()).toEqual(['breakdown', 'loading', 'reason', 'refresh'])
    expect(typeof result.current.refresh).toBe('function')
  })

  it('the invalidation entry point still exists', () => {
    // lifecycle.ts (on `session.reclaimed`) and slash.ts (after `/compress`)
    // both call this. Without it the rail never learns the transcript moved.
    expect(typeof invalidateContextBreakdown).toBe('function')
    expect(() => invalidateContextBreakdown('contract')).not.toThrow()
  })

  it.each(STORES)('%s is still a readable atom', (_name, atom) => {
    expect(typeof atom.get).toBe('function')
    expect(atom.get).not.toThrow()
  })

  it('the rail keeps its width contract', () => {
    expect(SESSION_RAIL_DEFAULT_WIDTH).toBe('15rem')
    expect(SESSION_RAIL_MIN_WIDTH).toBe('11rem')
    expect(SESSION_RAIL_MAX_WIDTH).toBe('22rem')
  })

  it('every rendered card still has translated copy', () => {
    // A card id without copy renders an empty header — the card-visibility menu
    // and the card Shell both read these.
    expect(en.sessionRail.title.length).toBeGreaterThan(0)
    expect(en.sessionRail.refresh.length).toBeGreaterThan(0)
    expect(en.sessionRail.configureCards.length).toBeGreaterThan(0)

    for (const cardId of SESSION_RAIL_CARDS) {
      expect(en.sessionRail.cards[cardId]?.title, `cards.${cardId}.title`).toBeTruthy()
    }

    // The context card's four mutually exclusive states.
    for (const key of ['used', 'notLoaded', 'unavailable', 'empty', 'loading'] as const) {
      expect(en.sessionRail.cards.context[key], `context.${key}`).toBeTruthy()
    }
  })

  it('the refresh tick still reaches subscribers', () => {
    const seen: number[] = []
    const unsubscribe = $railRefreshTick.subscribe(value => seen.push(value))

    refreshRail()
    refreshRail()
    unsubscribe()

    expect(seen).toEqual([0, 1, 2])
  })
})
