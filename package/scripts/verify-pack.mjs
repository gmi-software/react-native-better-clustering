// Verifies what `npm pack` would publish, so a stray file can never reach npm
// again (1.0.0 shipped a compiled arm64 benchmark binary and bench.cpp, which
// defines `int main()` and is compiled by the podspec glob).
//
// Runs `npm pack --dry-run --json`, which also runs the prepack/postpack
// scripts, then checks the file list against a deny-list, a required-list, and
// the packed files' contents (native binaries, `main` definitions).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: packageRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
// Lifecycle scripts (prepack runs nitrogen) print to the same stdout; npm
// writes the JSON report last, starting with a line that is just `[`.
const jsonStart = output.search(/^\[\s*$/m)
if (jsonStart === -1) {
  console.error(output)
  throw new Error('npm pack --json produced no JSON report')
}
const [pack] = JSON.parse(output.slice(jsonStart))
const files = pack.files.map((file) => file.path)

const DENIED = [
  { pattern: /(^|\/)bench(\/|\.|$)/, reason: 'benchmark sources or binaries' },
  { pattern: /(^|\/)cluster_(test|bench)$/, reason: 'locally built test binary' },
  { pattern: /\.test\.[cm]?[jt]sx?$|\.test\.cpp$/, reason: 'test file' },
  { pattern: /(^|\/)__(tests|audit)__\//, reason: 'test directory' },
  { pattern: /\.(tgz|o|a|so|dylib|dSYM)$/, reason: 'build artifact' },
]

const REQUIRED = [
  'README.md',
  'package.json',
  'nitro.json',
  'react-native.config.js',
  'react-native-better-clustering.podspec',
  'lib/module/index.js',
  'lib/typescript/index.d.ts',
  'nitrogen/generated/ios/NitroMapCluster+autolinking.rb',
  'nitrogen/generated/android/NitroMapCluster+autolinking.gradle',
  'nitrogen/generated/android/NitroMapCluster+autolinking.cmake',
  'cpp/HybridClusterEngine.cpp',
  'android/CMakeLists.txt',
]

// Mach-O (32/64-bit, both endiannesses, fat) and ELF.
const BINARY_MAGICS = [
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  '7f454c46',
]

const NATIVE_SOURCE = /\.(c|cc|cpp|cxx|m|mm)$/
const DEFINES_MAIN = /^\s*(int|auto)\s+main\s*\(/m

const problems = []

for (const file of files) {
  for (const { pattern, reason } of DENIED) {
    if (pattern.test(file)) {
      problems.push(`${file}: ${reason} must not be published`)
    }
  }

  const absolute = path.join(packageRoot, file)
  // README.md is copied in by prepack and removed again by postpack.
  if (!fs.existsSync(absolute)) continue

  const fd = fs.openSync(absolute, 'r')
  const head = Buffer.alloc(4)
  fs.readSync(fd, head, 0, 4, 0)
  fs.closeSync(fd)
  if (BINARY_MAGICS.includes(head.toString('hex'))) {
    problems.push(`${file}: native binary must not be published`)
  }

  if (NATIVE_SOURCE.test(file) && DEFINES_MAIN.test(fs.readFileSync(absolute, 'utf8'))) {
    problems.push(`${file}: defines main() and would be linked into consumer apps`)
  }
}

for (const file of REQUIRED) {
  if (!files.includes(file)) {
    problems.push(`${file}: required in the package but missing`)
  }
}

if (problems.length > 0) {
  console.error(`npm pack verification failed (${problems.length} problem(s)):`)
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  process.exit(1)
}

console.log(
  `npm pack OK: ${files.length} files, ${(pack.unpackedSize / 1024).toFixed(1)} kB unpacked`
)
