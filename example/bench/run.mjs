#!/usr/bin/env node
// Runs the example app's Benchmark scenario over Maestro and collects the
// results, with the app's memory sampled from the host at each phase.
//
//   node bench/run.mjs --platform ios --device <simulator udid> --out results/ios-main.json
//   node bench/run.mjs --platform android --device emulator-5554 --out results/android-main.json
//
// Options: --app-id (default com.nitromapcluster.example), --libs rnmc,rnbc,
// --counts 10000,50000,100000, --runs 5. A Release build of the app must be
// installed on the device. See README.md.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = {
    appId: 'com.nitromapcluster.example',
    libs: 'rnmc,rnbc',
    counts: '10000,50000,100000',
    runs: '5',
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '')
    args[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[index + 1]
  }
  for (const required of ['platform', 'device', 'out']) {
    if (args[required] == null) {
      console.error(`Missing --${required}`)
      process.exit(2)
    }
  }
  return {
    ...args,
    libs: args.libs.split(','),
    counts: args.counts.split(',').map(Number),
    runs: Number(args.runs),
  }
}

const args = parseArgs(process.argv.slice(2))
const adb = join(
  process.env.ANDROID_HOME ?? join(process.env.HOME, 'Library/Android/sdk'),
  'platform-tools/adb'
)

/** The app's memory in bytes: phys_footprint on iOS, total PSS on Android. */
function sampleMemory() {
  if (args.platform === 'ios') {
    const list = execFileSync(
      'xcrun',
      ['simctl', 'spawn', args.device, 'launchctl', 'list'],
      { encoding: 'utf8' }
    )
    const line = list
      .split('\n')
      .find((row) => row.includes(`UIKitApplication:${args.appId}[`))
    const pid = Number(line?.split('\t')[0])
    if (!Number.isInteger(pid)) {
      return null
    }
    const dir = mkdtempSync(join(tmpdir(), 'footprint-'))
    try {
      const file = join(dir, 'footprint.json')
      execFileSync('footprint', ['-p', String(pid), '--noCategories', '-j', file], {
        stdio: 'ignore',
      })
      const report = JSON.parse(readFileSync(file, 'utf8'))
      return { footprintBytes: report.processes[0].footprint }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const meminfo = execFileSync(
    adb,
    ['-s', args.device, 'shell', 'dumpsys', 'meminfo', args.appId],
    { encoding: 'utf8' }
  )
  const kb = (label) => {
    const match = meminfo.match(new RegExp(`${label}:?\\s+([\\d,]+)`))
    return match == null ? null : Number(match[1].replace(/,/g, '')) * 1024
  }
  return {
    pssBytes: kb('TOTAL PSS'),
    nativeHeapBytes: kb('Native Heap'),
    javaHeapBytes: kb('Java Heap'),
  }
}

function deviceInfo() {
  if (args.platform === 'ios') {
    const devices = JSON.parse(
      execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], {
        encoding: 'utf8',
      })
    ).devices
    for (const [runtime, list] of Object.entries(devices)) {
      const device = list.find(({ udid }) => udid === args.device)
      if (device != null) {
        return {
          kind: 'iOS Simulator',
          name: device.name,
          runtime: runtime.split('.').pop(),
          host: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], {
            encoding: 'utf8',
          }).trim(),
        }
      }
    }
    return { kind: 'iOS Simulator', udid: args.device }
  }
  const prop = (name) =>
    execFileSync(adb, ['-s', args.device, 'shell', 'getprop', name], {
      encoding: 'utf8',
    }).trim()
  return {
    kind: prop('ro.kernel.qemu') === '1' ? 'Android emulator' : 'Android device',
    model: prop('ro.product.model'),
    android: prop('ro.build.version.release'),
    abi: prop('ro.product.cpu.abi'),
  }
}

/**
 * A run takes 1 to 3 minutes, and up to 10 for react-native-map-clustering's
 * 100,000 markers on an Android emulator; a hung Maestro must not stall the rest.
 */
const RUN_TIMEOUT_MS = 15 * 60 * 1000

function runMaestro(maestroArgs) {
  return new Promise((resolve) => {
    const child = spawn('maestro', maestroArgs)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}

/** Stops the app, so the next run starts a fresh process; fine if it is not running. */
function stopApp() {
  const [command, commandArgs] =
    args.platform === 'ios'
      ? ['xcrun', ['simctl', 'terminate', args.device, args.appId]]
      : [adb, ['-s', args.device, 'shell', 'am', 'force-stop', args.appId]]
  try {
    execFileSync(command, commandArgs, { stdio: 'ignore' })
  } catch {
    // Not running.
  }
}

let current = null
const server = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => (body += chunk))
  request.on('end', () => {
    const url = new URL(request.url, 'http://localhost')
    if (current != null && url.pathname === '/mark') {
      current.memory[url.searchParams.get('phase')] = sampleMemory()
    } else if (current != null && url.pathname === '/result') {
      current.result = JSON.parse(body)
    }
    response.end('ok')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const host = `http://127.0.0.1:${server.address().port}`

const out = resolve(args.out)
const report = {
  generatedAt: new Date().toISOString(),
  platform: args.platform,
  appId: args.appId,
  device: deviceInfo(),
  runs: [],
}
const save = () => writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

// Runs interleave the libraries and sizes, so drift over time (heat, other
// load on the host) spreads over every case instead of landing on one.
for (let run = 1; run <= args.runs; run += 1) {
  for (const count of args.counts) {
    for (const lib of args.libs) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        current = { run, lib, count, attempt, memory: {}, result: null }
        stopApp()
        const started = Date.now()
        // Asynchronous: the collector must answer the flow's requests meanwhile.
        const maestro = await runMaestro(
          [
            '--device',
            args.device,
            'test',
            join(here, 'flow.yaml'),
            '-e',
            `APP_ID=${args.appId}`,
            '-e',
            `LIB=${lib}`,
            '-e',
            `COUNT=${count}`,
            '-e',
            `HOST=${host}`,
          ]
        )
        const seconds = Math.round((Date.now() - started) / 1000)
        if (maestro.status === 0 && current.result != null) {
          report.runs.push(current)
          save()
          console.log(
            `run ${run} ${lib} ${count}: ok in ${seconds}s` +
              (current.result.error ? ` (app: ${current.result.error})` : '')
          )
          break
        }
        console.log(
          `run ${run} ${lib} ${count}: attempt ${attempt} failed in ${seconds}s`
        )
        console.log(
          `${maestro.stdout}\n${maestro.stderr}`.trim().split('\n').slice(-15).join('\n')
        )
      }
    }
  }
}
current = null
server.close()
console.log(`Wrote ${out}`)
