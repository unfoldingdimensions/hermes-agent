/**
 * Per-card visibility for the session rail.
 *
 * The rail shows a fixed set of cards; the user hides the ones they don't care
 * about. Hidden-ness is per CARD, not per pane — the whole rail is one pane in
 * the layout tree, so the tree's own `$hiddenTreePanes` (which hides whole
 * panes) is the wrong granularity and lives in a different store.
 *
 * The hidden set is persisted per profile: the rail describes ONE session's
 * surroundings, and a user who works in two profiles usually wants the same
 * cards in both, but a profile-scoped key keeps one profile's pruning from
 * silently reordering another's. The key is suffixed with the profile so the
 * two never bleed.
 *
 * An unknown card id (a card removed in a later version) is DROPPED on read
 * rather than kept: carrying it forward would make a card that no longer
 * exists invisible-but-stored forever.
 */

import { atom } from 'nanostores'

import { readKey, writeKey } from '@/lib/storage'

/** The cards the rail can show, in display order. */
export const SESSION_RAIL_CARDS = [
  'context',
  'environment',
  'changes',
  'background',
  'servers',
  'connectors'
] as const

export type SessionRailCardId = (typeof SESSION_RAIL_CARDS)[number]

const CARD_IDS: ReadonlySet<string> = new Set(SESSION_RAIL_CARDS)

export function isSessionRailCardId(value: unknown): value is SessionRailCardId {
  return typeof value === 'string' && CARD_IDS.has(value)
}

const STORAGE_KEY_PREFIX = 'hermes.desktop.sessionRail.hiddenCards.v1'

/**
 * The storage key for a profile.
 *
 * The DEFAULT profile owns the bare key: it is the one every install has, so
 * keeping it unsuffixed means an unscoped read and a default-profile read are
 * the SAME key. Suffixing it would leave two keys that both claim to be "the
 * default profile's cards" and silently disagree.
 */
function storageKey(profile?: null | string): string {
  return !profile || profile === 'default' ? STORAGE_KEY_PREFIX : `${STORAGE_KEY_PREFIX}.${profile}`
}

/** Parse a persisted hidden set, dropping ids that are no longer cards. */
function parseHidden(raw: null | string): ReadonlySet<SessionRailCardId> {
  if (!raw) {
    return new Set()
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupt value reads as "nothing hidden" — the safe default is the full
    // set of cards, not an empty rail.
    return new Set()
  }

  if (!Array.isArray(parsed)) {
    return new Set()
  }

  const out = new Set<SessionRailCardId>()

  for (const entry of parsed) {
    if (isSessionRailCardId(entry)) {
      out.add(entry)
    }
  }

  return out
}

/** The hidden set for a profile, read from storage. */
export function readHiddenCards(profile?: null | string): ReadonlySet<SessionRailCardId> {
  return parseHidden(readKey(storageKey(profile)))
}

/**
 * The live hidden set.
 *
 * Seeded from storage at module load so the FIRST paint already honours the
 * user's saved choice — otherwise the rail would flash every card and then
 * hide some of them a tick later, once the profile's set had loaded.
 */
export const $hiddenRailCards = atom<ReadonlySet<SessionRailCardId>>(readHiddenCards())

/** Load the persisted hidden set for a profile into the live store. */
export function loadHiddenCards(profile?: null | string): void {
  $hiddenRailCards.set(readHiddenCards(profile))
}

/** Show or hide one card, and persist the change for the profile. */
export function setRailCardHidden(cardId: SessionRailCardId, hidden: boolean, profile?: null | string): void {
  const next = new Set($hiddenRailCards.get())

  if (hidden) {
    next.add(cardId)
  } else {
    next.delete(cardId)
  }

  $hiddenRailCards.set(next)
  persistHiddenCards(next, profile)
}

/** Flip one card's visibility and return the new hidden state. */
export function toggleRailCard(cardId: SessionRailCardId, profile?: null | string): boolean {
  const hidden = !$hiddenRailCards.get().has(cardId)
  setRailCardHidden(cardId, hidden, profile)

  return hidden
}

/** The cards to render, in display order, honouring the hidden set. */
export function visibleRailCards(hidden: ReadonlySet<SessionRailCardId> = $hiddenRailCards.get()): SessionRailCardId[] {
  return SESSION_RAIL_CARDS.filter(cardId => !hidden.has(cardId))
}

/** Persist a hidden set for a profile. */
export function persistHiddenCards(hidden: ReadonlySet<SessionRailCardId>, profile?: null | string): void {
  const ids = SESSION_RAIL_CARDS.filter(cardId => hidden.has(cardId))
  writeKey(storageKey(profile), JSON.stringify(ids))
}

/** Reset the live store — used by tests. */
export function _resetHiddenRailCards(): void {
  $hiddenRailCards.set(new Set())
}
