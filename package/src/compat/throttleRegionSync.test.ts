import {
  createThrottleRegionSyncState,
  flushThrottledRegionSync,
  scheduleThrottledRegionSync,
  type ThrottleRegionSyncState,
} from './throttleRegionSync'
import type { Region } from 'react-native-maps'

const region = (latitude: number): Region => ({
  latitude,
  longitude: 0,
  latitudeDelta: 1,
  longitudeDelta: 1,
})

describe('scheduleThrottledRegionSync', () => {
  let state: ThrottleRegionSyncState
  let now: number
  let sync: jest.Mock<void, [Region]>
  let scheduled: Array<{ callback: () => void; delay: number }>

  beforeEach(() => {
    jest.useFakeTimers()
    state = createThrottleRegionSyncState()
    now = 0
    sync = jest.fn()
    scheduled = []

    jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
      const entry = {
        callback: callback as () => void,
        delay: delay as number,
      }
      scheduled.push(entry)
      return scheduled.length as unknown as ReturnType<typeof setTimeout>
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const deps = () => ({
    intervalMs: 100,
    now: () => now,
    schedule: (callback: () => void, delayMs: number) => {
      scheduled.push({ callback, delay: delayMs })
      return scheduled.length as unknown as ReturnType<typeof setTimeout>
    },
    clearSchedule: jest.fn(),
  })

  it('syncs immediately on the first call (leading edge)', () => {
    scheduleThrottledRegionSync(region(1), sync, state, deps())

    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith(region(1))
    expect(scheduled).toHaveLength(0)
  })

  it('performs one leading and one trailing sync for rapid calls within the interval', () => {
    scheduleThrottledRegionSync(region(1), sync, state, deps())
    sync.mockClear()
    now = 10

    scheduleThrottledRegionSync(region(2), sync, state, deps())
    scheduleThrottledRegionSync(region(3), sync, state, deps())
    scheduleThrottledRegionSync(region(4), sync, state, deps())

    expect(sync).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].delay).toBe(90)

    now = 100
    scheduled[0].callback()

    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith(region(4))
  })

  it('syncs again immediately once the interval has elapsed', () => {
    scheduleThrottledRegionSync(region(1), sync, state, deps())
    sync.mockClear()
    now = 150

    scheduleThrottledRegionSync(region(2), sync, state, deps())

    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith(region(2))
    expect(scheduled).toHaveLength(0)
  })

  it('skips in-gesture syncs when intervalMs is 0', () => {
    scheduleThrottledRegionSync(region(1), sync, state, {
      ...deps(),
      intervalMs: 0,
    })
    scheduleThrottledRegionSync(region(2), sync, state, {
      ...deps(),
      intervalMs: 0,
    })

    expect(sync).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(0)
  })
})

describe('flushThrottledRegionSync', () => {
  let state: ThrottleRegionSyncState
  let now: number
  let sync: jest.Mock<void, [Region]>
  let clearSchedule: jest.Mock<void, [ReturnType<typeof setTimeout>]>

  beforeEach(() => {
    state = createThrottleRegionSyncState()
    now = 0
    sync = jest.fn()
    clearSchedule = jest.fn()
  })

  it('cancels a pending trailing sync and syncs the settled region immediately', () => {
    const timerId = 1 as unknown as ReturnType<typeof setTimeout>
    state.timerId = timerId
    state.latestRegion = region(3)

    flushThrottledRegionSync(region(5), sync, state, {
      now: () => now,
      clearSchedule,
    })

    expect(clearSchedule).toHaveBeenCalledWith(timerId)
    expect(state.timerId).toBeNull()
    expect(sync).toHaveBeenCalledWith(region(5))
  })
})
