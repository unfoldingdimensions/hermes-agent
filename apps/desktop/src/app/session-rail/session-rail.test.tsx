import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $hiddenRailCards, _resetHiddenRailCards, persistHiddenCards } from './card-visibility'

import { SessionRailPane } from './index'

const mocks = vi.hoisted(() => ({
  listMcpServers: vi.fn(),
  getCronJobs: vi.fn(),
  getMessagingPlatforms: vi.fn()
}))

vi.mock('@/api/mcp', () => ({ listMcpServers: mocks.listMcpServers }))
vi.mock('@/api/cron', () => ({ getCronJobs: mocks.getCronJobs }))
vi.mock('@/api/messaging', () => ({ getMessagingPlatforms: mocks.getMessagingPlatforms }))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway: vi.fn() })
}))

vi.mock('@/app/shell/hooks/use-context-breakdown', () => ({
  useContextBreakdown: () => ({ breakdown: null, loading: false })
}))

vi.mock('@/store/coding-status', async () => {
  const { atom } = await import('nanostores')

  return {
    $repoStatus: atom(null),
    $repoWorktrees: atom([])
  }
})

vi.mock('@/store/subagents', async () => {
  const { atom } = await import('nanostores')

  return { $subagentsBySession: atom({}) }
})

vi.mock('@/store/session-states', async () => {
  const { atom } = await import('nanostores')

  return {
    $focusedRuntimeId: atom(null),
    $focusedWorkspaceCwd: atom(null)
  }
})

vi.mock('@/store/profile', async () => {
  const { atom } = await import('nanostores')

  return { $activeProfile: atom('default') }
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sessionRail: {
        title: 'Session',
        configureCards: 'Cards',
        noCards: 'No cards shown. Use Cards to pick which ones to display.',
        cards: {
          background: { title: 'Background', empty: 'Nothing running', running: 'running', more: 'more', scheduled: 'Scheduled jobs' },
          changes: { title: 'Changes', clean: 'Working tree clean', staged: 'Staged', unstaged: 'Modified', untracked: 'Untracked', conflicted: 'Conflicted', lines: 'Lines' },
          connectors: { title: 'Connectors', empty: 'No connectors connected', loading: 'Loading…', on: 'On', off: 'Off' },
          context: { title: 'Context', empty: 'No context yet', loading: 'Loading…' },
          environment: { title: 'Environment', empty: 'No folder', folder: 'Folder', branch: 'Branch', sync: 'Sync', inSync: 'In sync', worktrees: 'Worktrees' },
          servers: { title: 'Servers', empty: 'No MCP servers', loading: 'Loading…', more: 'more' }
        }
      }
    }
  })
}))

describe('SessionRailPane', () => {
  beforeEach(() => {
    window.localStorage.clear()
    _resetHiddenRailCards()
    mocks.listMcpServers.mockResolvedValue({ servers: [] })
    mocks.getCronJobs.mockResolvedValue([])
    mocks.getMessagingPlatforms.mockResolvedValue({ platforms: [] })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.clear()
    _resetHiddenRailCards()
  })

  it('renders every card by default', () => {
    render(<SessionRailPane />)

    expect(screen.getByText('Context')).toBeTruthy()
    expect(screen.getByText('Environment')).toBeTruthy()
    expect(screen.getByText('Changes')).toBeTruthy()
    expect(screen.getByText('Background')).toBeTruthy()
    expect(screen.getByText('Servers')).toBeTruthy()
    expect(screen.getByText('Connectors')).toBeTruthy()
  })

  it('renders a card shell with its data-card attribute', () => {
    const { container } = render(<SessionRailPane />)

    expect(container.querySelector('[data-card="context"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="session-rail"]')).toBeTruthy()
  })

  it('shows the empty state for a card with no data', () => {
    render(<SessionRailPane />)

    expect(screen.getByText('No context yet')).toBeTruthy()
    expect(screen.getByText('Working tree clean')).toBeTruthy()
  })

  it('hides a card when it is toggled off', () => {
    // Persist first, then render: the rail's mount effect loads the persisted
    // set, so that is the path a returning user actually takes.
    persistHiddenCards(new Set(['servers']))

    render(<SessionRailPane />)

    expect(screen.queryByText('Servers')).toBeNull()
    // The others survive.
    expect(screen.getByText('Context')).toBeTruthy()
  })

  it('says so when every card is hidden', () => {
    persistHiddenCards(new Set(['context', 'environment', 'changes', 'background', 'servers', 'connectors']))

    render(<SessionRailPane />)

    expect(screen.getByText('No cards shown. Use Cards to pick which ones to display.')).toBeTruthy()
  })

  it('offers every card in the configure menu', async () => {
    render(<SessionRailPane />)

    // Radix's dropdown trigger opens on pointerdown, not on a synthetic
    // 'click' alone, so fire the full mouse sequence a real click produces.
    const button = screen.getByText('Cards')
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(button, { button: 0, pointerType: 'mouse' })
    fireEvent.click(button)

    expect(await screen.findByRole('menu')).toBeTruthy()
    // Every card is a checkable item, checked while it is visible.
    const items = await screen.findAllByRole('menuitemcheckbox')
    expect(items).toHaveLength(6)

    for (const item of items) {
      expect(item.getAttribute('aria-checked')).toBe('true')
    }
  })

  it('unchecks a card when it is toggled off from the menu', async () => {
    render(<SessionRailPane />)

    const button = screen.getByText('Cards')
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(button, { button: 0, pointerType: 'mouse' })
    fireEvent.click(button)

    const servers = await screen.findByRole('menuitemcheckbox', { name: 'Servers' })
    fireEvent.click(servers)

    expect($hiddenRailCards.get().has('servers')).toBe(true)
  })
})
