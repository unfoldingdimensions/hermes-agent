import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $hiddenRailCards, _resetHiddenRailCards, persistHiddenCards } from './card-visibility'

import { SessionRailPane } from './index'

const mocks = vi.hoisted(() => ({
  listMcpServers: vi.fn(),
  getCronJobs: vi.fn(),
  getMessagingPlatforms: vi.fn(),
  breakdown: { current: null as null | Record<string, unknown> },
  breakdownReason: { current: null as null | string }
}))

vi.mock('@/api/mcp', () => ({ listMcpServers: mocks.listMcpServers }))
vi.mock('@/api/cron', () => ({ getCronJobs: mocks.getCronJobs }))
vi.mock('@/api/messaging', () => ({ getMessagingPlatforms: mocks.getMessagingPlatforms }))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway: vi.fn() })
}))

vi.mock('@/app/shell/hooks/use-context-breakdown', () => ({
  useContextBreakdown: () => ({
    breakdown: mocks.breakdown.current,
    loading: false,
    reason: mocks.breakdownReason.current
  })
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
          context: { title: 'Context', used: 'Used', notLoaded: 'Session not loaded', unavailable: 'Context unavailable', empty: 'No context yet', loading: 'Loading…' },
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
    mocks.breakdown.current = null
    mocks.breakdownReason.current = null
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

  it('says the session is not loaded, rather than claiming there is no context', () => {
    // A stored conversation that has not been resumed into a live agent has
    // no context to measure — but "No context yet" about a 122-message
    // session is a lie the user can see through.
    mocks.breakdownReason.current = 'no-session'

    render(<SessionRailPane />)

    expect(screen.getByText('Session not loaded')).toBeTruthy()
    expect(screen.queryByText('No context yet')).toBeNull()
  })

  it('shows the absolute context total, and EVERY category', () => {
    // The card once showed a bare percentage and only the first five
    // categories. The transcript is the biggest category by far and it is
    // LAST in the backend's display order, so truncating the list hid the one
    // number that explained the gap between the rows and the total: the rows
    // summed to ~22k while the session was really using 382.6k.
    mocks.breakdown.current = {
      // The REAL category list, in the backend's display order. Eight of them,
      // so a card that truncates the list to five drops the last three —
      // including the transcript, the largest one.
      categories: [
        { color: '', id: 'system_prompt', label: 'System prompt', tokens: 9600 },
        { color: '', id: 'tool_definitions', label: 'Tool definitions', tokens: 10100 },
        { color: '', id: 'rules', label: 'Rules', tokens: 412 },
        { color: '', id: 'skills', label: 'Skills', tokens: 900 },
        { color: '', id: 'mcp', label: 'MCP', tokens: 200 },
        { color: '', id: 'subagent_definitions', label: 'Subagent definitions', tokens: 1200 },
        { color: '', id: 'memory', label: 'Memory', tokens: 1100 },
        { color: '', id: 'conversation', label: 'Conversation', tokens: 350000 }
      ],
      context_max: 1000000,
      context_percent: 38,
      context_used: 382600,
      estimated_total: 369700
    }

    render(<SessionRailPane />)

    // The absolute figure the percentage is computed from, and the window.
    expect(screen.getByText('Used')).toBeTruthy()
    expect(screen.getByText('382.6k / 1M')).toBeTruthy()
    expect(screen.getByText('38%')).toBeTruthy()

    // Every category, including the ones the truncation used to drop.
    expect(screen.getByText('System prompt')).toBeTruthy()
    expect(screen.getByText('Tool definitions')).toBeTruthy()
    expect(screen.getByText('Subagent definitions')).toBeTruthy()
    expect(screen.getByText('Memory')).toBeTruthy()
    expect(screen.getByText('Conversation')).toBeTruthy()
    // The category rows are local estimates, so they are marked as such.
    expect(screen.getByText('~9.6k')).toBeTruthy()
    expect(screen.getByText('~350k')).toBeTruthy()
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
