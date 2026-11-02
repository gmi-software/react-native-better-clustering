export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Resolves once `condition()` holds, checking every 50 ms; rejects after `timeoutMs`. */
export async function waitUntil(condition: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error('timed out')
    }
    await sleep(50)
  }
}
