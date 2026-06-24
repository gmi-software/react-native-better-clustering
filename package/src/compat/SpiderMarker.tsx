import React, { memo } from 'react'
import { Polyline } from 'react-native-maps'
import type { SpiralPosition } from './spiral'
import { isMarker } from './helpers'

export interface SpiderMarkerProps {
  marker: React.ReactElement
  position: SpiralPosition
  spiderLineColor: string
}

function SpiderMarker({
  marker,
  position,
  spiderLineColor,
}: SpiderMarkerProps) {
  if (!isMarker(marker)) {
    return null
  }

  return (
    <>
      {React.cloneElement(marker, {
        coordinate: {
          latitude: position.latitude,
          longitude: position.longitude,
        },
      })}
      <Polyline
        coordinates={[
          {
            latitude: position.latitude,
            longitude: position.longitude,
          },
          position.centerPoint,
        ]}
        strokeColor={spiderLineColor}
        strokeWidth={1}
      />
    </>
  )
}

export default memo(SpiderMarker)
