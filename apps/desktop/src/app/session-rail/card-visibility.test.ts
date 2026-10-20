import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $hiddenRailCards,
  _resetHiddenRailCards,
  isSessionRailCardId,
  loadHiddenCards,
  persistHiddenCards,
  readHiddenCards,
  SESSION_RAIL_CARDS,
  setRailCardHidden,
  toggleRailCard,
  visibleRailCards
} from './card-visibility'

describe('session rail card visibility', () => {
  beforeEach(() => {
    window.localStorage.clear()
    _resetHiddenRailCards()
  })

  afterEach(() => {
    window.localStorage.clear()
    _resetHiddenRailCards()
  })

  it('starts with every card visible', () => {
    expect(visibleRailCards(new Set())).toEqual([...SESSION_RAIL_CARDS])
  })

  it('hides a card and persists it', () => {
    setRailCardHidden('servers', true)

    expect($hiddenRailCards.get().has('servers')).toBe(true)
    expect(visibleRailCards($hiddenRailCards.get())).not.toContain('servers')
    expect(readHiddenCards()).toContain('servers')
  })

  it('shows a card again', () => {
    setRailCardHidden('servers', true)
    setRailCardHidden('servers', false)

    expect($hiddenRailCards.get().has('servers')).toBe(false)
    expect(visibleRailCards($hiddenRailCards.get())).toContain('servers')
  })

  it('toggles a card and reports the new state', () => {
    expect(toggleRailCard('changes')).toBe(true)
    expect(toggleRailCard('changes')).toBe(false)
  })

  it('keeps the display order regardless of the order cards were hidden', () => {
    setRailCardHidden('servers', true)
    setRailCardHidden('context', true)

    expect(visibleRailCards($hiddenRailCards.get())).toEqual(['environment', 'changes', 'background', 'connectors'])
  })

  it('scopes the hidden set per profile', () => {
    setRailCardHidden('servers', true, 'work')

    expect(readHiddenCards('work').has('servers')).toBe(true)
    expect(readHiddenCards('default').has('servers')).toBe(false)
    expect(readHiddenCards().has('servers')).toBe(false)
  })

  it('loads the persisted set for a profile into the live store', () => {
    persistHiddenCards(new Set(['servers', 'changes']), 'work')

    loadHiddenCards('work')

    expect($hiddenRailCards.get().has('servers')).toBe(true)
    expect($hiddenRailCards.get().has('changes')).toBe(true)
  })

  it('drops a stored card id that is no longer a card', () => {
    window.localStorage.setItem('hermes.desktop.sessionRail.hiddenCards.v1', JSON.stringify(['servers', 'outputs']))

    // `outputs` was never a card; a stale id must not linger in the set.
    expect(readHiddenCards().has('servers')).toBe(true)
    expect(readHiddenCards().has('outputs' as never)).toBe(false)
  })

  it('reads a corrupt stored value as nothing hidden', () => {
    window.localStorage.setItem('hermes.desktop.sessionRail.hiddenCards.v1', '{not json')

    expect(readHiddenCards().size).toBe(0)
  })

  it('reads a non-array stored value as nothing hidden', () => {
    window.localStorage.setItem('hermes.desktop.sessionRail.hiddenCards.v1', JSON.stringify({ servers: true }))

    expect(readHiddenCards().size).toBe(0)
  })

  it('recognises only real card ids', () => {
    expect(isSessionRailCardId('context')).toBe(true)
    expect(isSessionRailCardId('outputs')).toBe(false)
    expect(isSessionRailCardId(42)).toBe(false)
  })
})
