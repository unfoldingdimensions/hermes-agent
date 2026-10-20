import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Contribution } from '@/contrib/types'

/**
 * The rail must arrive as its OWN COLUMN for EVERY user, including the ones
 * whose saved layout predates it.
 *
 * A user who already had Hermes has a persisted layout tree that names no
 * session-rail. When the app boots, the rail is a registered pane that is
 * absent from that tree, so the tree ADOPTS it (`adoptContributedPanes`).
 * The adoption path is the risky one: if it lands the rail as a tab, the
 * user's file tree disappears behind it — the one arrangement the rail must
 * never take, and the one a first-time user would never see.
 *
 * The adoption is governed by the pane's `dock` hint, and `pos: 'right'` is an
 * EDGE SPLIT (`insertAtGroup`), so the rail becomes a sibling column. `enforce`
 * makes that relationship an INVARIANT re-checked on every boot, so a rail
 * that a previous boot wedged somewhere else is re-homed.
 *
 * THIS FILE REPRODUCES THE REAL SHAPE. A synthetic flat row of groups is not
 * enough: the install that actually misbehaved had a COLUMN root holding a ROW
 * of groups — a sessions group carrying plugin panes, a workspace group, and a
 * minimised files/review group — and the rail landed INSIDE the sessions group
 * as a tab. A layout that only looks right in the simplest shape is not a
 * layout.
 */

const RAIL_DATA = { dock: { enforce: true, pane: 'workspace', pos: 'right' }, placement: 'main' }

describe('session rail adoption into a real install layout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
  })

  async function setup() {
    const tree = await import('@/components/pane-shell/tree/store')
    const model = await import('@/components/pane-shell/tree/model')
    const { registry } = await import('@/contrib/registry')

    // The panes a long-standing install already has.
    for (const [id, data] of [
      ['sessions', { placement: 'left' }],
      ['workspace', { placement: 'main' }],
      ['terminal', { placement: 'bottom' }],
      ['files', { placement: 'right' }],
      ['review', { placement: 'right' }]
    ] as const) {
      registry.register({ area: 'panes', data, id, render: () => null, title: id })
    }

    // A layout saved BEFORE the rail existed, in the shape a real install has:
    // a COLUMN root, a ROW of groups inside it, the sessions group carrying
    // plugin panes, and the files/review group minimised.
    tree.declareDefaultTree(
      model.split(
        'column',
        [
          model.split(
            'row',
            [
              model.group(['sessions', 'preview', 'hermes-bots:pane'], { id: 'g-sessions' }),
              model.group(['workspace', 'session-tile:abc'], { id: 'g-workspace' }),
              model.group(['files', 'review'], { id: 'g-files', minimized: true })
            ],
            [1, 3.2, 1.2]
          ),
          model.group(['terminal'], { id: 'g-terminal', minimized: true })
        ],
        [3, 1]
      )
    )

    return { model, tree }
  }

  function registerRail(registry: { register: (c: Contribution) => unknown }, data = RAIL_DATA) {
    registry.register({
      area: 'panes',
      data,
      id: 'session-rail',
      render: () => null,
      title: 'Session'
    } as Contribution)
  }

  it('adopts the rail as its own column, not a tab', async () => {
    const { model, tree } = await setup()
    const { registry } = await import('@/contrib/registry')

    // Now the rail registers — the app boots with a pane the saved layout
    // has never seen.
    registerRail(registry)

    tree.adoptContributedPanes()

    const live = tree.$layoutTree.get()
    expect(live).not.toBeNull()

    const railGroup = model.findGroupOfPane(live!, 'session-rail')
    expect(railGroup).not.toBeNull()
    // A column of its own — NOT sharing a zone with anything.
    expect(railGroup?.panes).toEqual(['session-rail'])
  })

  it('does not land in the sessions group, whatever the saved layout looks like', async () => {
    const { model, tree } = await setup()
    const { registry } = await import('@/contrib/registry')

    registerRail(registry)

    tree.adoptContributedPanes()

    const live = tree.$layoutTree.get()!
    const railGroup = model.findGroupOfPane(live, 'session-rail')
    const sessionsGroup = model.findGroupOfPane(live, 'sessions')

    expect(railGroup?.id).not.toBe(sessionsGroup?.id)
  })

  it('re-homes a rail that a previous boot wedged into the sessions group', async () => {
    const { model, tree } = await setup()
    const { registry } = await import('@/contrib/registry')

    // The rail IS already in the tree — wedged into the sessions group, the
    // shape the real install ended up with.
    const live = tree.$layoutTree.get()!

    const wedged = model.insertAtGroup(
      live,
      model.findGroupOfPane(live, 'sessions')!.id,
      'session-rail',
      'center'
    )

    tree.declareDefaultTree(wedged!)

    registerRail(registry)

    tree.adoptContributedPanes()

    const after = tree.$layoutTree.get()!
    const railGroup = model.findGroupOfPane(after, 'session-rail')
    const sessionsGroup = model.findGroupOfPane(after, 'sessions')

    expect(railGroup?.id).not.toBe(sessionsGroup?.id)
    expect(railGroup?.panes).toEqual(['session-rail'])
  })

  it('leaves the file tree visible beside the rail', async () => {
    const { model, tree } = await setup()
    const { registry } = await import('@/contrib/registry')

    registerRail(registry)

    tree.adoptContributedPanes()

    const live = tree.$layoutTree.get()!
    const railGroup = model.findGroupOfPane(live, 'session-rail')
    const filesGroup = model.findGroupOfPane(live, 'files')

    // Different zones: showing the rail never hides the file tree.
    expect(railGroup?.id).not.toBe(filesGroup?.id)
    expect(model.allPaneIds(live)).toContain('files')
  })

  it('is NOT a collapsible side, so the file tree closing does not take the rail with it', async () => {
    const { model, tree } = await setup()
    const { registry } = await import('@/contrib/registry')

    registerRail(registry)

    tree.adoptContributedPanes()

    const live = tree.$layoutTree.get()!

    // The whole point of `placement: 'main'`. A root-row column is a
    // COLLAPSIBLE SIDE by POSITION: anything right of the last
    // main-placement pane is the 'right' side, and the entire side collapses
    // as one (`paneRootSide` → `sideGone` in tree-split.tsx).
    //
    // With `placement: 'right'` the rail sat in that side, so the file tree's
    // normal closed state made the rail render at ZERO WIDTH — invisible,
    // with its cards live in the DOM the whole time. The rail must be its
    // own side boundary, so it is never dragged down with a neighbour.
    expect(tree.treeSideOfPane('session-rail')).toBeNull()
    // And the file tree keeps its own collapse behaviour, untouched.
    expect(tree.treeSideOfPane('files')).toBe('right')

    // Sanity: the rail really is in the tree the side logic reads.
    expect(model.allPaneIds(live)).toContain('session-rail')
  })
})
