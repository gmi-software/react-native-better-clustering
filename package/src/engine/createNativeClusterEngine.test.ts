import { describe, expect, it, jest, mock } from 'bun:test'

const engine = { isBuilt: false }
const createHybridObject = jest.fn((): unknown => engine)

// Registered before the modules under test are imported (below).
mock.module('react-native-nitro-modules', () => ({
  NitroModules: { createHybridObject },
}))

const { createNativeClusterEngine } =
  await import('./createNativeClusterEngine')
const { createClusterEngine } = await import('./index')

describe('createNativeClusterEngine', () => {
  it('creates the ClusterEngine hybrid object', () => {
    expect(createNativeClusterEngine()).toBe(engine as never)
    expect(createHybridObject).toHaveBeenCalledWith('ClusterEngine')
  })

  it('explains how to fix a missing native module and keeps the cause', () => {
    const missing = new Error('HybridObject "ClusterEngine" is not registered')
    createHybridObject.mockImplementationOnce(() => {
      throw missing
    })

    let thrown: unknown = null
    try {
      createNativeClusterEngine()
    } catch (error) {
      thrown = error
    }

    const { message, cause } = thrown as Error
    expect(message).toStartWith('react-native-better-clustering:')
    expect(message).toContain('Rebuild the app after installing the library')
    expect(message).toContain(`Cause: ${missing.message}`)
    expect(cause).toBe(missing)
  })

  it('backs the headless createClusterEngine', () => {
    createHybridObject.mockImplementationOnce(() => {
      throw new Error('not registered')
    })

    expect(() => createClusterEngine()).toThrow('Expo Go is not supported')
  })
})
