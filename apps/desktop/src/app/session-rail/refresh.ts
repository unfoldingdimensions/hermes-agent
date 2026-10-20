/**
 * The rail's "ask again now" signal.
 *
 * Cards read the app's existing stores, so most of the time they update
 * themselves. Two cases do not:
 *
 *  - A card whose data comes from a one-shot fetch that failed — the context
 *    card's retry ladder can exhaust and leave the meter dark with no way back
 *    except an unrelated session switch.
 *  - A store the user knows is stale (an event landed outside the app).
 *
 * A single monotonic tick both cases can subscribe to keeps the escape hatch at
 * the RAIL level — one button in the header — rather than one per card, and
 * keeps every card free of a refresh API it would not otherwise need.
 */

import { atom } from 'nanostores'

/** Bumped by the header's refresh control; cards subscribe and re-ask. */
export const $railRefreshTick = atom(0)

/** Ask every card to re-read its source. */
export function refreshRail(): void {
  $railRefreshTick.set($railRefreshTick.get() + 1)
}

/** Reset the tick (test isolation — the atom is module-level). */
export function _resetRailRefreshForTests(): void {
  $railRefreshTick.set(0)
}
