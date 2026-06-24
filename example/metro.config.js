// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const { resolve: resolveRequest } = require('metro-resolver')
const path = require('path')

const expoPackageRoot = path.dirname(require.resolve('expo/package.json'))
const exclusionList = require(
  require.resolve('@expo/metro/metro-config/defaults/exclusionList', {
    paths: [expoPackageRoot],
  })
).default

const PACKAGE_NAME = '@gmisoftware/react-native-better-clustering'

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '..')
const libraryRoot = path.resolve(monorepoRoot, 'package')

const config = getDefaultConfig(projectRoot)

// Watch the whole monorepo so changes to the local library source are picked up.
config.watchFolders = [monorepoRoot]

const exampleNodeModules = path.resolve(projectRoot, 'node_modules')

// Resolve modules from the example first, then the hoisted monorepo root.
config.resolver.nodeModulesPaths = [
  exampleNodeModules,
  path.resolve(monorepoRoot, 'node_modules'),
]

// Single canonical entry for the local package (avoids symlink + watchFolder duplicates).
config.resolver.extraNodeModules = {
  [PACKAGE_NAME]: libraryRoot,
}

// Never bundle compiled `lib/` output while developing against `src/`.
config.resolver.blockList = exclusionList([
  new RegExp(
    `${path.resolve(libraryRoot, 'lib').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`
  ),
])

// The library has its own `react` and `react-native-maps` (devDependencies).
// When Metro bundles the library `src`, hierarchical lookup can pick those
// copies instead of the example app's singletons — force shared packages to
// the example.
function resolveFromExample(moduleName) {
  return {
    type: 'sourceFile',
    filePath: require.resolve(moduleName, { paths: [exampleNodeModules] }),
  }
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === 'react' ||
    moduleName.startsWith('react/') ||
    moduleName === 'react-native' ||
    moduleName.startsWith('react-native/') ||
    moduleName === 'react-native-nitro-modules' ||
    moduleName.startsWith('react-native-nitro-modules/') ||
    moduleName === 'react-native-maps' ||
    moduleName.startsWith('react-native-maps/')
  ) {
    return resolveFromExample(moduleName)
  }

  return resolveRequest(context, moduleName, platform)
}

module.exports = config
