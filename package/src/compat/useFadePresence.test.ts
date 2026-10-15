import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { act, renderHook } from '@testing-library/react'

import { useFadePresence } from './useFadePresence'

describe('useFadePresence', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps removed items in the first render after removal with exiting true', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useFadePresence(items, 300),
      {
        initialProps: {
          items: [
            { key: 'a', data: 1 },
            { key: 'b', data: 2 },
          ],
        },
      }
    )

    act(() => {
      jest.runOnlyPendingTimers()
    })

    rerender({ items: [{ key: 'a', data: 1 }] })

    expect(result.current).toEqual([
      { key: 'a', data: 1, exiting: false },
      { key: 'b', data: 2, exiting: true },
    ])
  })

  it('drops removed items immediately when exitDurationMs is 0', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useFadePresence(items, 0),
      {
        initialProps: {
          items: [
            { key: 'a', data: 1 },
            { key: 'b', data: 2 },
          ],
        },
      }
    )

    act(() => {
      jest.runOnlyPendingTimers()
    })

    rerender({ items: [{ key: 'a', data: 1 }] })

    expect(result.current).toEqual([{ key: 'a', data: 1, exiting: false }])
  })

  it('removes exiting items after exitDurationMs elapses', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useFadePresence(items, 300),
      {
        initialProps: {
          items: [
            { key: 'a', data: 1 },
            { key: 'b', data: 2 },
          ],
        },
      }
    )

    act(() => {
      jest.runOnlyPendingTimers()
    })

    rerender({ items: [{ key: 'a', data: 1 }] })

    act(() => {
      jest.advanceTimersByTime(300)
    })

    expect(result.current).toEqual([{ key: 'a', data: 1, exiting: false }])
  })

  it('cancels exit when a key is re-added before the timer fires', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useFadePresence(items, 300),
      {
        initialProps: {
          items: [
            { key: 'a', data: 1 },
            { key: 'b', data: 2 },
          ],
        },
      }
    )

    act(() => {
      jest.runOnlyPendingTimers()
    })

    rerender({ items: [{ key: 'a', data: 1 }] })

    rerender({
      items: [
        { key: 'a', data: 1 },
        { key: 'b', data: 3 },
      ],
    })

    expect(result.current).toEqual([
      { key: 'a', data: 1, exiting: false },
      { key: 'b', data: 3, exiting: false },
    ])
  })

  describe('when exitDurationMs changes during an exit', () => {
    const both = [
      { key: 'a', data: 1 },
      { key: 'b', data: 2 },
    ]
    const onlyA = [{ key: 'a', data: 1 }]

    function removeBAfter(exitDurationMs: number) {
      const hook = renderHook(
        ({ items, exitMs }) => useFadePresence(items, exitMs),
        { initialProps: { items: both, exitMs: exitDurationMs } }
      )
      act(() => {
        jest.runOnlyPendingTimers()
      })
      hook.rerender({ items: onlyA, exitMs: exitDurationMs })
      return hook
    }

    const keys = (entries: Array<{ key: string }>) =>
      entries.map((entry) => entry.key)

    it('restarts the exit with a longer duration', () => {
      const { result, rerender } = removeBAfter(100)
      act(() => {
        jest.advanceTimersByTime(40)
      })

      rerender({ items: onlyA, exitMs: 250 })
      act(() => {
        jest.advanceTimersByTime(249)
      })
      expect(keys(result.current)).toEqual(['a', 'b'])

      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(keys(result.current)).toEqual(['a'])
    })

    it('keeps the exit as it is with a shorter duration', () => {
      const { result, rerender } = removeBAfter(250)
      act(() => {
        jest.advanceTimersByTime(40)
      })

      rerender({ items: onlyA, exitMs: 100 })
      act(() => {
        jest.advanceTimersByTime(209)
      })
      expect(keys(result.current)).toEqual(['a', 'b'])

      act(() => {
        jest.advanceTimersByTime(1)
      })
      expect(keys(result.current)).toEqual(['a'])
    })
  })
})
