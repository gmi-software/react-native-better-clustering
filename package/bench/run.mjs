// Runs the core benchmark: compiles bench.cpp against a ClusterEngineCore
// checkout, runs one process per (dataset, size) case and writes every result
// to one JSON file. See README.md in this directory.
//
//   bun run bench                         # wall time, all datasets and sizes
//   bun run bench -- --mode count         # instruction counts (needs valgrind)
//   bun run bench -- --datasets city --sizes 10000 --out -
//
// Options:
//   --mode time|count|all  time: wall time, allocations, memory (default).
//                          count: one run per operation under callgrind for
//                          instruction counts, plus allocations and memory.
//                          all: both, merged.
//   --datasets a,b         dataset names (default: all)
//   --sizes 100,1000       point counts (default: 100,1000,5000,10000,50000,100000)
//   --cpp <dir>            engine headers to measure (default: ../cpp)
//   --src <dir>            harness sources to compile (default: this directory)
//   --out <file>           JSON output path, `-` for stdout (default: results/latest.json)
//   --label <name>         recorded in the output, e.g. base or head
//   --jobs <n>             parallel callgrind processes (default: CPU count)
//   --quick                fewer timing samples, for a fast local check
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const benchDir = path.dirname(fileURLToPath(import.meta.url))

const SCHEMA_VERSION = 1
const DEFAULT_SIZES = [100, 1000, 5000, 10000, 50000, 100000]
const CXX_FLAGS = ['-std=c++20', '-O2', '-DNDEBUG', '-ffp-contract=off']

function parseArgs(argv) {
  const options = {
    mode: 'time',
    datasets: null,
    sizes: DEFAULT_SIZES,
    cpp: path.join(benchDir, '..', 'cpp'),
    src: benchDir,
    out: path.join(benchDir, 'results', 'latest.json'),
    label: 'local',
    jobs: os.availableParallelism?.() ?? os.cpus().length,
    quick: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) fail(`missing value for ${arg}`)
      return argv[++i]
    }
    if (arg === '--mode') options.mode = value()
    else if (arg === '--datasets') options.datasets = value().split(',')
    else if (arg === '--sizes') options.sizes = value().split(',').map(Number)
    else if (arg === '--cpp') options.cpp = path.resolve(value())
    else if (arg === '--src') options.src = path.resolve(value())
    else if (arg === '--out') options.out = value()
    else if (arg === '--label') options.label = value()
    else if (arg === '--jobs') options.jobs = Math.max(1, Number(value()))
    else if (arg === '--quick') options.quick = true
    else fail(`unknown argument ${arg}`)
  }
  if (!['time', 'count', 'all'].includes(options.mode)) {
    fail(`--mode must be time, count or all, not ${options.mode}`)
  }
  if (options.sizes.some((size) => !Number.isInteger(size) || size <= 0)) {
    fail('--sizes must be positive integers')
  }
  return options
}

function fail(message) {
  console.error(`bench: ${message}`)
  process.exit(2)
}

function firstLine(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.split('\n')[0].trim() : null
}

function compile(options) {
  const cxx = process.env.CXX || 'c++'
  const binary = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-bench-')),
    'cluster_bench'
  )
  // Resolve every library call at load time, so lazy binding never shows up
  // in an instruction count.
  const linkFlags = process.platform === 'linux' ? ['-Wl,-z,now'] : []
  const args = [
    ...CXX_FLAGS,
    `-I${options.cpp}`,
    `-I${options.src}`,
    path.join(options.src, 'bench.cpp'),
    '-o',
    binary,
    ...linkFlags,
  ]
  console.error(`bench: compiling against ${options.cpp}`)
  const result = spawnSync(cxx, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.status !== 0) {
    console.error(`bench: ${cxx} ${args.join(' ')} failed`)
    process.exit(1)
  }
  return {
    binary,
    compiler: { command: cxx, version: firstLine(cxx, ['--version']) },
    flags: [...CXX_FLAGS, ...linkFlags],
  }
}

function gitRevision(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function runHarness(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(binary)} ${args.join(' ')} exited with ${result.status}\n${result.stderr}`
    )
  }
  return JSON.parse(result.stdout)
}

function timingArgs(options) {
  return options.quick
    ? ['--min-samples', '5', '--min-time-ms', '50', '--max-time-ms', '1000']
    : []
}

function spawnAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

// Each CALLGRIND_DUMP_STATS_AT(name) request writes a profile part whose
// header names the request (`desc: Trigger: Client Request: <name>`) and whose
// `summary:` and `totals:` lines hold the instructions executed since the
// preceding CALLGRIND_ZERO_STATS. Parts are read line by line, so they may sit
// in separate files (callgrind's default) or in one.
function readCallgrindDumps(dir) {
  const instructions = {}
  for (const file of fs.readdirSync(dir)) {
    let request = null
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const line of text.split('\n')) {
      const trigger = line.match(/^desc: Trigger: (.*)$/)
      if (trigger != null) {
        const client = trigger[1].match(/^Client Request: (.+)$/)
        request = client == null ? null : client[1].trim()
        continue
      }
      const total = line.match(/^(?:summary|totals):\s+(\d+)/)
      if (total != null && request != null) {
        instructions[request] ??= Number(total[1])
      }
    }
  }
  return instructions
}

async function countCase(binary, dataset, size) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-bench-cg-'))
  try {
    const args = [
      '--tool=callgrind',
      `--callgrind-out-file=${path.join(dir, 'callgrind.out')}`,
      '--dump-line=no',
      '--compress-strings=no',
      '--compress-pos=no',
      binary,
      '--dataset',
      dataset,
      '--size',
      String(size),
      '--once',
    ]
    const result = await spawnAsync('valgrind', args)
    if (result.status !== 0) {
      throw new Error(
        `valgrind ${dataset}/${size} exited with ${result.status}\n${result.stderr}`
      )
    }
    const measured = JSON.parse(result.stdout)
    if (!measured.callgrind) {
      throw new Error(
        'the harness was compiled without <valgrind/callgrind.h>; install valgrind (it ships the header) and rerun'
      )
    }
    const instructions = readCallgrindDumps(dir)
    for (const op of measured.ops) {
      if (instructions[op.name] == null) {
        throw new Error(`no callgrind dump for ${dataset}/${size} ${op.name}`)
      }
      op.instructions = instructions[op.name]
    }
    return measured
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function runPool(tasks, jobs) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(jobs, tasks.length) }, worker)
  )
  return results
}

// Every case reports the same engine configuration; the report keeps one copy.
let engineConfig = null

function toCase(measured) {
  engineConfig ??= measured.config
  const ops = {}
  for (const op of measured.ops) {
    const { name, ...metrics } = op
    ops[name] = metrics
  }
  return {
    dataset: measured.dataset,
    size: measured.size,
    datasetHash: measured.datasetHash,
    memorySize: measured.memorySize,
    peakRssBytes: measured.peakRssBytes,
    ops,
  }
}

// Instruction counts come from the callgrind run, wall time and peak RSS from
// the native one. Allocations and memory are the same in both.
function mergeCases(timed, counted) {
  if (timed == null) return counted
  if (counted == null) return timed
  for (const [name, op] of Object.entries(timed.ops)) {
    const countedOp = counted.ops[name]
    if (countedOp == null) continue
    op.instructions = countedOp.instructions
    if (op.allocationCount !== countedOp.allocationCount) {
      console.error(
        `bench: warning: ${timed.dataset}/${timed.size} ${name} allocates ${op.allocationCount} times natively but ${countedOp.allocationCount} times under valgrind`
      )
    }
  }
  return timed
}

function formatCount(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}G`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

function printSummary(cases) {
  console.error('')
  console.error(
    'dataset        size      build ms   build Ir   allocs   memory MB  z12 µs'
  )
  for (const c of cases) {
    const build = c.ops.build
    const z12 = c.ops.clusters_z12
    console.error(
      [
        c.dataset.padEnd(12),
        String(c.size).padStart(7),
        (build.time ? (build.time.medianNs / 1e6).toFixed(2) : '-').padStart(
          12
        ),
        (build.instructions != null
          ? formatCount(build.instructions)
          : '-'
        ).padStart(10),
        formatCount(build.allocationCount).padStart(8),
        (c.memorySize / 1048576).toFixed(2).padStart(11),
        (z12?.time ? (z12.time.medianNs / 1e3).toFixed(1) : '-').padStart(7),
      ].join(' ')
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const { binary, compiler, flags } = compile(options)
  const known = JSON.parse(
    execFileSync(binary, ['--list'], { encoding: 'utf8' })
  )
  const datasets = options.datasets ?? known
  for (const name of datasets) {
    if (!known.includes(name))
      fail(`unknown dataset ${name}; known: ${known.join(', ')}`)
  }

  const plan = datasets.flatMap((dataset) =>
    options.sizes.map((size) => ({ dataset, size }))
  )

  let counted = []
  if (options.mode !== 'time') {
    if (spawnSync('valgrind', ['--version']).status !== 0) {
      fail(
        '--mode count needs valgrind on PATH (Linux; it does not run on Apple silicon)'
      )
    }
    console.error(
      `bench: counting instructions for ${plan.length} cases, ${options.jobs} at a time`
    )
    counted = await runPool(
      plan.map(({ dataset, size }) => async () => {
        const measured = toCase(await countCase(binary, dataset, size))
        console.error(`bench: counted ${dataset}/${size}`)
        return measured
      }),
      options.jobs
    )
  }

  let timed = []
  if (options.mode !== 'count') {
    // Serial: concurrent cases would disturb each other's wall time.
    timed = plan.map(({ dataset, size }) => {
      const measured = toCase(
        runHarness(binary, [
          '--dataset',
          dataset,
          '--size',
          String(size),
          ...timingArgs(options),
        ])
      )
      console.error(`bench: timed ${dataset}/${size}`)
      return measured
    })
  }

  const cases = plan.map((_, i) => mergeCases(timed[i], counted[i]))
  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    label: options.label,
    mode: options.mode,
    environment: {
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model?.trim() ?? null,
      runner: process.env.GITHUB_ACTIONS
        ? `github-actions ${process.env.ImageOS ?? ''} ${process.env.ImageVersion ?? ''}`.trim()
        : 'local',
      compiler: compiler.version,
      flags,
      valgrind:
        options.mode === 'time' ? null : firstLine('valgrind', ['--version']),
      node: process.version,
      engineRevision: gitRevision(options.cpp),
    },
    config: engineConfig,
    cases,
  }

  fs.rmSync(path.dirname(binary), { recursive: true, force: true })

  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.out === '-') {
    process.stdout.write(json)
  } else {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true })
    fs.writeFileSync(options.out, json)
    console.error(`bench: wrote ${options.out}`)
  }
  printSummary(cases)
}

await main()
