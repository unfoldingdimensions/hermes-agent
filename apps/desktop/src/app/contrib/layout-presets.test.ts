import { describe, expect, it } from 'vitest'

import { findGroupOfPane, type LayoutNode } from '@/components/pane-shell/tree/model'

import { BASIC_TREE, DEFAULT_TREE } from './layout-presets'

/** The pane ids of a tree, in the order the tree lays them out. */
function paneOrder(tree: LayoutNode): string[] {
  if (tree.type === 'group') {
    return [...tree.panes]
  }

  return tree.children.flatMap(child => paneOrder(child))
}

/**
 * The session rail's placement is an ARCHITECTURAL decision, not a preference:
 * it must be its own column beside the conversation. If it ever became a tab in
 * the right zone, showing the rail would hide the file tree — the one
 * arrangement it must not take. These tests lock that in.
 */
describe('session rail layout placement', () => {
  it('gives the rail its own column in the default tree', () => {
    const railGroup = findGroupOfPane(DEFAULT_TREE, 'session-rail')

    expect(railGroup).not.toBeNull()
    // A column of its own: the rail is ALONE in its zone.
    expect(railGroup?.panes).toEqual(['session-rail'])
  })

  it('keeps the rail out of the right sidebar zone', () => {
    const railGroup = findGroupOfPane(DEFAULT_TREE, 'session-rail')
    const filesGroup = findGroupOfPane(DEFAULT_TREE, 'files')
    const reviewGroup = findGroupOfPane(DEFAULT_TREE, 'review')

    // files and review share one zone (they are tabs); the rail must not.
    expect(filesGroup?.panes).toEqual(['files'])
    expect(reviewGroup?.panes).toEqual(['review'])
    expect(railGroup?.id).not.toBe(filesGroup?.id)
    expect(railGroup?.id).not.toBe(reviewGroup?.id)
  })

  it('keeps the rail between the conversation and the right sidebar', () => {
    const order = paneOrder(DEFAULT_TREE)
    const workspace = order.indexOf('workspace')
    const rail = order.indexOf('session-rail')
    const files = order.indexOf('files')

    expect(workspace).toBeGreaterThan(-1)
    expect(rail).toBeGreaterThan(workspace)
    expect(files).toBeGreaterThan(rail)
  })

  it('rests the rail in the basic layout, closed but present', () => {
    // Basic is the "just the chat" layout: the rail is in the tree so it can be
    // opened, but it is a RESTING pane like the file tree.
    const railGroup = findGroupOfPane(BASIC_TREE, 'session-rail')

    expect(railGroup).not.toBeNull()
    expect(railGroup?.panes).toEqual(['session-rail'])
  })
})
