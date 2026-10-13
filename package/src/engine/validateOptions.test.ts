import { describe, expect, it } from 'bun:test'

import { DEFAULT_SUPERCLUSTER_OPTIONS } from './defaults'
import type { SuperclusterOptions } from './types'
import {
  validateClusterId,
  validateSuperclusterOptions,
} from './validateOptions'

function validate(overrides: SuperclusterOptions): void {
  validateSuperclusterOptions({
    ...DEFAULT_SUPERCLUSTER_OPTIONS,
    ...overrides,
  })
}

// Numbers that cannot cross into the native int32 fields.
const NON_INT32 = [Infinity, -Infinity, NaN, 1e12, -1e12, 0.5]

describe('validateSuperclusterOptions', () => {
  it('accepts the defaults and the full supported zoom range', () => {
    expect(() => validate({})).not.toThrow()
    expect(() => validate({ minZoom: 0, maxZoom: 30 })).not.toThrow()
    expect(() => validate({ minZoom: 12, maxZoom: 12 })).not.toThrow()
  })

  it('accepts values that are unusual but well defined', () => {
    expect(() => validate({ radius: 0 })).not.toThrow()
    expect(() => validate({ radius: 23.4 })).not.toThrow()
    expect(() => validate({ minPoints: 1 })).not.toThrow()
    expect(() => validate({ nodeSize: 0 })).not.toThrow()
    expect(() => validate({ viewportTileSize: 300.5 })).not.toThrow()
  })

  it.each(['minPoints', 'minZoom', 'maxZoom', 'extent', 'nodeSize'] as const)(
    'rejects a %s that is not a 32-bit integer, naming it',
    (name) => {
      for (const value of NON_INT32) {
        expect(() => validate({ [name]: value })).toThrow(
          `react-native-better-clustering: ${name} must be`
        )
      }
    }
  )

  it.each([NaN, Infinity, -Infinity, -1])('rejects radius %p', (radius) => {
    expect(() => validate({ radius })).toThrow(
      `react-native-better-clustering: radius must be a finite number >= 0, got ${radius}.`
    )
  })

  it('rejects zooms outside 0 to 30', () => {
    expect(() => validate({ maxZoom: 100 })).toThrow(
      'react-native-better-clustering: maxZoom must be an integer from 0 to 30, got 100.'
    )
    expect(() => validate({ minZoom: -1 })).toThrow(
      'minZoom must be an integer from 0 to 30, got -1.'
    )
  })

  it('rejects minZoom above maxZoom, which would build no levels', () => {
    expect(() => validate({ minZoom: 12, maxZoom: 10 })).toThrow(
      'react-native-better-clustering: minZoom (12) must not be greater than maxZoom (10).'
    )
  })

  it('rejects a non-positive extent', () => {
    expect(() => validate({ extent: 0 })).toThrow(
      'extent must be an integer >= 1, got 0.'
    )
  })

  it.each([0, -256, NaN, Infinity])(
    'rejects viewportTileSize %p',
    (viewportTileSize) => {
      expect(() => validate({ viewportTileSize })).toThrow(
        'viewportTileSize must be a finite number > 0'
      )
    }
  )

  it('quotes a string so it reads as the wrong type', () => {
    expect(() => validate({ radius: '40' as unknown as number })).toThrow(
      'radius must be a finite number >= 0, got "40".'
    )
  })
})

describe('validateClusterId', () => {
  it('accepts any 32-bit integer, including ids no node has', () => {
    for (const id of [0, 7, -1, 2 ** 31 - 1]) {
      expect(() => validateClusterId(id)).not.toThrow()
    }
  })

  it('rejects anything else, naming clusterId', () => {
    for (const id of [...NON_INT32, 2 ** 31]) {
      expect(() => validateClusterId(id)).toThrow(
        `react-native-better-clustering: clusterId must be a 32-bit integer, got ${id}.`
      )
    }
  })
})
