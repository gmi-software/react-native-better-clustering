import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'quick-start',
    'setup/installation',
    {
      type: 'category',
      label: 'API Reference',
      link: { type: 'doc', id: 'api/mapview' },
      items: [
        'api/mapview',
        'api/hooks',
        'api/clusterer',
        'api/types',
        'api/engine',
      ],
    },
    'troubleshooting',
    'compatibility',
  ],
};

export default sidebars;
