/**
 * Records when each JS frame callback runs. A callback runs only when the JS
 * thread is free, so the gap between two callbacks is how long the thread was
 * busy: a gap of one frame interval is a smooth frame, a 2 s gap is a 2 s
 * freeze during which no touch handler, timer or state update ran.
 */
export interface FrameMonitor {
  /** Frame times (from `performance.now()`) recorded so far. */
  readonly frames: readonly number[]
  stop(): void
}

export function startFrameMonitor(): FrameMonitor {
  const frames: number[] = [performance.now()]
  let running = true
  let frameId = requestAnimationFrame(function onFrame() {
    if (!running) {
      return
    }
    // When the callback runs, not the frame time it is passed: a busy thread
    // runs it late, and that delay is what this measures.
    frames.push(performance.now())
    frameId = requestAnimationFrame(onFrame)
  })
  return {
    frames,
    stop() {
      running = false
      cancelAnimationFrame(frameId)
    },
  }
}

/** A gap longer than this is a long task, as in Total Blocking Time. */
const LONG_TASK_MS = 50

export interface FrameStats {
  /** Frames recorded in the window. */
  frames: number
  /** Median gap between frames: the display's frame interval when idle. */
  frameIntervalMs: number
  /** The longest gap: the longest the JS thread was unresponsive. */
  maxGapMs: number
  /** Sum over gaps longer than 50 ms of the part above 50 ms (Total Blocking Time). */
  blockedMs: number
  /** Frames the JS thread missed: each gap counts its frame intervals minus one. */
  droppedFrames: number
}

/**
 * Frame statistics for the gaps that end inside `[start, end]`. `frameIntervalMs`
 * is the idle frame interval, measured before the window, so a busy window
 * cannot change the unit its dropped frames are counted in.
 */
export function frameStats(
  frames: readonly number[],
  start: number,
  end: number,
  frameIntervalMs: number
): FrameStats {
  let count = 0
  let maxGapMs = 0
  let blockedMs = 0
  let droppedFrames = 0
  for (let index = 1; index < frames.length; index += 1) {
    const at = frames[index]
    if (at < start || at > end) {
      continue
    }
    // A gap that started before the window counts only from its start.
    const gap = at - Math.max(frames[index - 1], start)
    count += 1
    maxGapMs = Math.max(maxGapMs, gap)
    if (gap > LONG_TASK_MS) {
      blockedMs += gap - LONG_TASK_MS
    }
    droppedFrames += Math.max(0, Math.round(gap / frameIntervalMs) - 1)
  }
  return {
    frames: count,
    frameIntervalMs: round(frameIntervalMs),
    maxGapMs: round(maxGapMs),
    blockedMs: round(blockedMs),
    droppedFrames,
  }
}

/** When the last frame that came more than `gapMs` after the one before it ran, or 0. */
export function lastLongFrameAt(frames: readonly number[], gapMs: number): number {
  for (let index = frames.length - 1; index > 0; index -= 1) {
    if (frames[index] - frames[index - 1] > gapMs) {
      return frames[index]
    }
  }
  return 0
}

/** The median gap between the frames inside `[start, end]`. */
export function medianFrameInterval(
  frames: readonly number[],
  start: number,
  end: number
): number {
  const gaps: number[] = []
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index - 1] >= start && frames[index] <= end) {
      gaps.push(frames[index] - frames[index - 1])
    }
  }
  if (gaps.length === 0) {
    return 1000 / 60
  }
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

export function round(value: number): number {
  return Math.round(value * 10) / 10
}
