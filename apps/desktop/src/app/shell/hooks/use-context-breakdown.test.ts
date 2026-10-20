import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextBreakdown } from '@/types/hermes'

import { deferred } from '../../../test/deferred'

import {
  _resetContextBreakdownInvalidationsForTests,
  invalidateContextBreakdown,
  useContextBreakdown
} from './use-context-breakdown'

type GatewayRequester = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

const LIVE_BREAKDOWN: ContextBreakdown = {
  categories: [],
  context_max: 1_048_576,
  context_percent: 42,
  context_used: 440_000,
  estimated_total: 440_000
}

const PRE_COMPRESSION_BREAKDOWN: ContextBreakdown = {
  categories: [],
  context_max: 1_048_576,
  context_percent: 91,
  context_used: 954_000,
  estimated_total: 954_000
}

/**
 * The agent-is-None branch's answer for a stored conversation: a measured
 * transcript with no window (the model is not resident to report one).
 */
const STORED_TRANSCRIPT_BREAKDOWN: ContextBreakdown = {
  categories: [{ color: '#7c9ef5', id: 'conversation', label: 'Conversation', tokens: 447_000 }],
  context_max: 0,
  context_percent: 0,
  context_used: 447_000,
  estimated_total: 447_000
}

const ZEROED_BREAKDOWN: ContextBreakdown = {
  categories: [],
  context_max: 0,
  context_percent: 0,
  context_used: 0,
  estimated_total: 0
}

function flushAsync() {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useContextBreakdown (#94001)', () => {
  it('caches a live breakdown keyed by session and serves it across busy toggles', async () => {
    const requestGateway = vi.fn().mockResolvedValue(LIVE_BREAKDOWN) as unknown as GatewayRequester

    const { result, rerender } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()

    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
    expect(requestGateway).toHaveBeenCalledTimes(1)

    // A busy toggle re-runs the effect; the fetched cache still serves.
    rerender({ busy: true, enabled: true, requestGateway, sessionId: 's1' })
    rerender({ busy: false, enabled: true, requestGateway, sessionId: 's1' })
    await flushAsync()

    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
  })

  it('drops the cached breakdown when the session changes (no cross-session contamination)', async () => {
    const requestGateway = vi.fn().mockResolvedValue(LIVE_BREAKDOWN) as unknown as GatewayRequester

    const { result, rerender } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()
    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)

    rerender({ busy: false, enabled: true, requestGateway, sessionId: 's2' })
    await flushAsync()

    // s2's fetch resolved with LIVE_BREAKDOWN too (same mock), so it serves —
    // but the point is the s1 entry did not leak during the s2 loading window.
    const requestGatewaySlow = vi.fn(
      (_method: string) => deferred<ContextBreakdown>().promise
    ) as unknown as GatewayRequester

    rerender({ busy: false, enabled: true, requestGateway: requestGatewaySlow, sessionId: 's3' })

    expect(result.current.breakdown).toBeNull()
  })

  it('evicts the stale cache and retries when the refetch fails, never serving pre-compression data', async () => {
    let fail = false

    const requestGateway = vi.fn(async () => {
      if (fail) {
        throw new Error('session not found')
      }

      return LIVE_BREAKDOWN
    }) as unknown as GatewayRequester

    const { result, rerender } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()
    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)

    // Simulate the post-compression window: the refetch races a reclaim and fails.
    fail = true
    rerender({ busy: true, enabled: true, requestGateway, sessionId: 's1' })
    rerender({ busy: false, enabled: true, requestGateway, sessionId: 's1' })
    await flushAsync()

    // First attempt failed and scheduled a bounded retry. The busy toggle
    // already dropped the cached snapshot (#70871), so nothing stale is
    // served while the ladder runs — recovery must come from a real fetch.
    // Flip the failure off BEFORE the timer fires, or retry 1 fails too.
    fail = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flushAsync()

    // Retry 1 succeeded (fail flipped back off) → recovered with live data.
    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
  })

  it('stops serving numbers after retries are exhausted against failures (dark meter, not a lie)', async () => {
    const requestGateway = vi.fn(async () => {
      throw new Error('rpc failed')
    }) as unknown as GatewayRequester

    const { result } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    // Seed a stale cache first: succeed once, then start failing forever.
    const flaky = vi.fn(async (_method: string) => {
      throw new Error('rpc failed')
    }) as unknown as GatewayRequester

    // Use two hooks: this test drives exhaustion directly from a cold start.
    const { result: cold } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway: flaky, sessionId: 'cold' as null | string }
    })

    await flushAsync()
    expect(cold.current.breakdown).toBeNull()

    // Exhaust the bounded retry ladder: 1s, 4s, 12s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flushAsync()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    await flushAsync()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    await flushAsync()

    expect(cold.current.breakdown).toBeNull()
    expect(cold.current.loading).toBe(false)
  })

  it('does not cache a zeroed breakdown (agentless window) and retries until a live agent answers', async () => {
    let zeroed = true

    const requestGateway = vi.fn(async () =>
      zeroed ? ZEROED_BREAKDOWN : LIVE_BREAKDOWN
    ) as unknown as GatewayRequester

    const { result } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()

    // Zeroed answer must not be cached as the served breakdown.
    expect(result.current.breakdown).toBeNull()

    // The agent finishes building BEFORE the backoff fires: flip the backend
    // state first, then advance — the retry must observe the live answer.
    zeroed = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flushAsync()

    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('never serves a previous session’s cached numbers after its own refetch exhausts retries', async () => {
    // Scenario 1 guard: the s1 cache must not paint under s2 while s2's fetch
    // exhausts its retries against a failing backend.
    let fail = false

    const requestGateway = vi.fn(async () => {
      if (fail) {
        throw new Error('rpc failed')
      }

      return PRE_COMPRESSION_BREAKDOWN
    }) as unknown as GatewayRequester

    const { result, rerender } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()
    expect(result.current.breakdown).toEqual(PRE_COMPRESSION_BREAKDOWN)

    // Switch to s2 whose backend keeps failing through the whole retry ladder.
    fail = true
    rerender({ busy: false, enabled: true, requestGateway, sessionId: 's2' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flushAsync()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })
    await flushAsync()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    await flushAsync()

    // s1's 91% must NOT appear under s2.
    expect(result.current.breakdown).toBeNull()
  })
})
describe('useContextBreakdown invalidation (#94001 follow-up)', () => {
  beforeEach(() => {
    _resetContextBreakdownInvalidationsForTests()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('refetches immediately when invalidateContextBreakdown bumps the session generation', async () => {
    let answer = PRE_COMPRESSION_BREAKDOWN
    const requestGateway = vi.fn(async () => answer) as unknown as GatewayRequester

    const { result, rerender } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()
    expect(result.current.breakdown).toEqual(PRE_COMPRESSION_BREAKDOWN)
    expect(requestGateway).toHaveBeenCalledTimes(1)

    // Compression happened outside any turn (no busy toggle) — invalidate.
    answer = LIVE_BREAKDOWN
    invalidateContextBreakdown('s1')
    rerender({ busy: false, enabled: true, requestGateway, sessionId: 's1' })
    await flushAsync()

    // The meter must serve the POST-compression figure without a busy toggle
    // or a session switch.
    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('does not refetch a different session when an unrelated session is invalidated', async () => {
    const requestGateway = vi.fn(async () => PRE_COMPRESSION_BREAKDOWN) as unknown as GatewayRequester

    const { result, rerender } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()
    expect(requestGateway).toHaveBeenCalledTimes(1)

    invalidateContextBreakdown('other-session')
    rerender({ busy: false, enabled: true, requestGateway, sessionId: 's1' })
    await flushAsync()

    expect(requestGateway).toHaveBeenCalledTimes(1)
    expect(result.current.breakdown).toEqual(PRE_COMPRESSION_BREAKDOWN)
  })

  it('serves a stored-transcript total even when the window is unknown', async () => {
    // The agent-is-None branch measures the stored transcript and cannot know
    // the model window without an agent. A real total is still data — refusing
    // it here is what made every non-resident session read "not loaded".
    const requestGateway = vi.fn().mockResolvedValue(
      STORED_TRANSCRIPT_BREAKDOWN
    ) as unknown as GatewayRequester

    const { result } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 'stored' as null | string }
    })

    await flushAsync()

    expect(result.current.breakdown).toEqual(STORED_TRANSCRIPT_BREAKDOWN)
    expect(result.current.reason).toBeNull()
    // One fetch — a usable answer is not retried.
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })

  it('restarts the ladder on invalidation instead of staying dark (dead-end fix)', async () => {
    // The bug: once the ladder exhausted, an invalidation re-ran the fetch with
    // `attempt` still at its final value, hit the exhausted branch immediately,
    // and left the meter dark — so a recovered agent never repainted the rail.
    let fail = true

    const requestGateway = vi.fn(async () => {
      if (fail) {
        throw new Error('rpc failed')
      }

      return LIVE_BREAKDOWN
    }) as unknown as GatewayRequester

    const { result } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()

    // Exhaust 1s, 4s, 12s.
    for (const delay of [1_000, 4_000, 12_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
      await flushAsync()
    }

    expect(result.current.breakdown).toBeNull()

    // A reclaim invalidation fires WHILE still failing — the real sequence: the
    // agent is gone, the reclaim bumps the generation, and the immediate refetch
    // fails too. With the exhausted ladder this scheduled nothing, so the meter
    // stayed dark forever. The invalidation must start a fresh ladder.
    act(() => invalidateContextBreakdown('s1'))
    await flushAsync()

    expect(result.current.breakdown).toBeNull()

    // The agent is back. Only a RE-SCHEDULED retry can pick it up: no other
    // trigger will fire, because nothing else changed.
    fail = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await flushAsync()

    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
  })

  it('refresh() re-asks from a clean ladder after the retries exhausted', async () => {
    let fail = true

    const requestGateway = vi.fn(async () => {
      if (fail) {
        throw new Error('rpc failed')
      }

      return LIVE_BREAKDOWN
    }) as unknown as GatewayRequester

    const { result } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()

    for (const delay of [1_000, 4_000, 12_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
      await flushAsync()
    }

    expect(result.current.breakdown).toBeNull()

    // The rail's refresh button: no session change, no invalidation, just a
    // deliberate ask. It must not re-enter the exhausted branch and no-op.
    fail = false
    act(() => result.current.refresh())
    await flushAsync()

    expect(result.current.breakdown).toEqual(LIVE_BREAKDOWN)
  })

  it('stops spinning as soon as an attempt settles without data', async () => {
    // The 17s trap: `loading` stayed true for the whole ladder, so the rail
    // showed a spinner and only then went dark. The reason should be readable
    // straight away while retries continue in the background.
    const requestGateway = vi.fn(async () => {
      throw new Error('rpc failed')
    }) as unknown as GatewayRequester

    const { result } = renderHook(props => useContextBreakdown(props), {
      initialProps: { busy: false, enabled: true, requestGateway, sessionId: 's1' as null | string }
    })

    await flushAsync()

    expect(result.current.loading).toBe(false)
    expect(result.current.reason).toBe('error')
  })
})
