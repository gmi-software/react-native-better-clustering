import type { ReactElement } from 'react'
import { BenchmarkScreen } from './bench/BenchmarkScreen'
import { AntimeridianScreen } from './screens/AntimeridianScreen'
import { BasicScreen } from './screens/BasicScreen'
import { ClusteringToggleScreen } from './screens/ClusteringToggleScreen'
import { CoLocatedScreen } from './screens/CoLocatedScreen'
import { CustomClusterScreen } from './screens/CustomClusterScreen'
import { LargeDatasetScreen } from './screens/LargeDatasetScreen'
import { LiveDataScreen } from './screens/LiveDataScreen'
import { LiveFleetScreen } from './screens/LiveFleetScreen'
import { ParentStateScreen } from './screens/ParentStateScreen'

export interface Scenario {
  /** Stable: Maestro flows open a scenario by `scenario-<id>`. */
  id: string
  title: string
  description: string
  render: () => ReactElement
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'basic',
    title: 'Basic',
    description: '2,000 static markers across Poland.',
    render: () => <BasicScreen />,
  },
  {
    id: 'parent-state',
    title: 'Parent state',
    description:
      'A selection and a visible list from onMarkersChange={setState}, with inline children.',
    render: () => <ParentStateScreen />,
  },
  {
    id: 'live-data',
    title: 'Live data',
    description: 'Append and remove markers while the map is on screen.',
    render: () => <LiveDataScreen />,
  },
  {
    id: 'live-fleet',
    title: 'Live fleet',
    description:
      'Static markers with vehicles that move several times a second.',
    render: () => <LiveFleetScreen />,
  },
  {
    id: 'co-located',
    title: 'Co-located markers',
    description: 'Markers sharing a coordinate: spiderfy, or one large bubble.',
    render: () => <CoLocatedScreen />,
  },
  {
    id: 'antimeridian',
    title: 'Antimeridian',
    description: 'Markers on both sides of ±180° near Fiji.',
    render: () => <AntimeridianScreen />,
  },
  {
    id: 'large-10k',
    title: '10k markers',
    description: '10,000 markers across Poland.',
    render: () => <LargeDatasetScreen count={10_000} />,
  },
  {
    id: 'large-50k',
    title: '50k markers',
    description: '50,000 markers across Poland.',
    render: () => <LargeDatasetScreen count={50_000} />,
  },
  {
    id: 'custom-cluster',
    title: 'Custom renderCluster',
    description: 'Clusters drawn by the app instead of the default bubble.',
    render: () => <CustomClusterScreen />,
  },
  {
    id: 'clustering-toggle',
    title: 'clusteringEnabled toggle',
    description: 'Turn clustering off and on without unmounting the map.',
    render: () => <ClusteringToggleScreen />,
  },
  {
    id: 'benchmark',
    title: 'Benchmark',
    description:
      'react-native-map-clustering vs this build, same markers: mount, parent re-renders, zoom.',
    render: () => <BenchmarkScreen />,
  },
]
