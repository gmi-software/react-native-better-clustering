import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'C++ Supercluster Engine',
    description: (
      <>
        Clustering runs in native C++ via Nitro Modules — faster than JS
        supercluster on the React Native bridge.
      </>
    ),
  },
  {
    title: 'Bring Your Own Map',
    description: (
      <>
        Use <code>useClusterer</code> with react-native-maps, or migrate from
        react-native-map-clustering via the compat layer.
      </>
    ),
  },
  {
    title: 'Cluster Aggregation',
    description: (
      <>
        <code>clusterProperties</code> map/reduce for aggregated values on
        clusters — beyond what react-native-clusterer offers.
      </>
    ),
  },
];

function Feature({ title, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
