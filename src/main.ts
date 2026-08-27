import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as path from 'path'
import * as io from '@actions/io'
import {ExecOptions} from '@actions/exec/lib/interfaces'

const FILE = core.getInput('file', {required: true})
const IS_WINDOWS = process.platform === 'win32'
const VS_VERSION = core.getInput('vs-version') || 'latest'
const VSWHERE_PATH = core.getInput('vswhere-path')
const ALLOW_PRERELEASE = core.getInput('vs-prerelease') || 'false'
const REQUIRES = core.getInput('requires') || ''
const REQUIRES_ANY = core.getInput('requires-any') || 'false'
const ARCHITECTURE = (core.getInput('architecture') || 'host').toLowerCase()

// arguments selecting which Visual Studio instances are looked into
let VSWHERE_SELECT = '-products *'

if (REQUIRES !== '') {
  VSWHERE_SELECT += ` -requires ${REQUIRES}`

  if (REQUIRES_ANY === 'true') {
    VSWHERE_SELECT += ' -requiresAny'
  }
}

if (ALLOW_PRERELEASE === 'true') {
  VSWHERE_SELECT += ' -prerelease'
}

// if a specific version of VS is requested
if (VS_VERSION === 'latest') {
  VSWHERE_SELECT += ' -latest'
} else {
  VSWHERE_SELECT += ` -version "${VS_VERSION}"`
}

const VSWHERE_EXEC = `${VSWHERE_SELECT} -find ${FILE}`

core.debug(`Execution arguments: ${VSWHERE_EXEC}`)

// path segments Visual Studio uses to store per-architecture copies of a tool
const ARCHITECTURES = ['x86', 'x64', 'arm', 'arm64']

// what a machine of a given architecture can actually execute, best first
const RUNNABLE: {[architecture: string]: string[]} = {
  x86: ['x86'],
  x64: ['x64', 'x86'],
  arm: ['arm', 'x86'],
  arm64: ['arm64', 'x64', 'x86']
}

// process.arch describes the node binary rather than the machine, an x86 node
// on an x64 runner would claim x86
function hostArchitecture(): string {
  const reported =
    process.env['PROCESSOR_ARCHITEW6432'] ||
    process.env['PROCESSOR_ARCHITECTURE'] ||
    ''

  const normalized = normalizeArchitecture(reported)
  if (normalized !== undefined) return normalized

  return process.arch === 'ia32' ? 'x86' : process.arch
}

function normalizeArchitecture(segment: string): string | undefined {
  const lowercase = segment.toLowerCase()
  // MSBuild uses `Bin\amd64`, the compilers use `Hostx64\x64`
  const name = lowercase === 'amd64' ? 'x64' : lowercase
  return ARCHITECTURES.includes(name) ? name : undefined
}

// Runs vswhere and returns its output, one entry per non-empty line.
// stdout can be split over several chunks, so it has to be joined back
// together before being parsed.
async function runVswhere(
  vswhereToolExe: string,
  args: string
): Promise<string[]> {
  let output = ''
  const options: ExecOptions = {}
  options.listeners = {
    stdout: (data: Buffer) => {
      output += data.toString()
    }
  }

  await exec.exec(`"${vswhereToolExe}" ${args}`, [], options)

  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
}

interface Candidate {
  // the file itself
  path: string
  // the architecture the file runs on, undefined when the path does not say
  host: string | undefined
  // the architecture it produces code for, undefined when the path does not say
  target: string | undefined
}

// A pattern such as `**\clang-tidy.exe` matches every copy Visual Studio ships.
// `VC\Tools\Llvm\x64\bin` is an x64-hosted clang while
// `VC\Tools\MSVC\<version>\bin\Hostx64\arm64` is an x64-hosted compiler
// producing arm64 code, so a bare segment names the host only as long as no
// `host` prefixed one did.
function classify(filePath: string): Candidate {
  let host: string | undefined
  let target: string | undefined

  for (const segment of filePath.split(/[\\/]/)) {
    const prefixed = segment.toLowerCase().startsWith('host')
      ? normalizeArchitecture(segment.slice(4))
      : undefined

    if (prefixed !== undefined) {
      host = prefixed
      continue
    }

    const bare = normalizeArchitecture(segment)
    if (bare !== undefined) {
      if (host === undefined) host = bare
      else target = bare
    }
  }

  return {path: filePath, host, target: target === undefined ? host : target}
}

// Lower is better, an exact match on the wanted architecture first, then a
// path that says nothing about architecture, then anything else.
function preferenceRank(
  architecture: string | undefined,
  wanted: string | undefined
): number {
  if (wanted === undefined) return 0
  if (architecture === wanted) return 0
  if (architecture === undefined) return 1
  return 2
}

// Visual Studio keeps every toolset it has ever installed side by side under
// `VC\Tools\MSVC\<version>`, and the newest one is the one msbuild would use.
function newerFirst(a: string, b: string): number {
  const left = a.split(/[\\/]/)
  const right = b.split(/[\\/]/)

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] === right[i]) continue

    const isVersion = /^\d+(\.\d+)+$/
    if (isVersion.test(left[i]) && isVersion.test(right[i])) {
      const parts = (value: string): number[] => value.split('.').map(Number)
      const [x, y] = [parts(left[i]), parts(right[i])]

      for (let part = 0; part < Math.max(x.length, y.length); part++) {
        const difference = (y[part] || 0) - (x[part] || 0)
        if (difference !== 0) return difference
      }
    }

    return left[i].localeCompare(right[i])
  }

  return left.length - right.length
}

function compare(
  wanted: string | undefined
): (a: Candidate, b: Candidate) => number {
  const runnable = RUNNABLE[hostArchitecture()] || []

  // among equally wanted copies, the one this machine runs best
  const runnableRank = (candidate: Candidate): number =>
    candidate.host === undefined ? 0.5 : runnable.indexOf(candidate.host)

  return (a: Candidate, b: Candidate): number =>
    preferenceRank(a.host, wanted) - preferenceRank(b.host, wanted) ||
    preferenceRank(a.target, wanted) - preferenceRank(b.target, wanted) ||
    runnableRank(a) - runnableRank(b) ||
    a.path.split(/[\\/]/).length - b.path.split(/[\\/]/).length ||
    newerFirst(a.path, b.path)
}

async function run(): Promise<void> {
  try {
    // exit if non Windows runner
    if (IS_WINDOWS === false) {
      core.setFailed('Lectem/vswhere can only be run on Windows runners')
      return
    }

    if (
      ARCHITECTURE !== 'host' &&
      ARCHITECTURE !== 'any' &&
      !ARCHITECTURES.includes(ARCHITECTURE)
    ) {
      core.setFailed(
        `Unknown architecture "${ARCHITECTURE}", expected one of ` +
          `host, any, ${ARCHITECTURES.join(', ')}`
      )

      return
    }

    // check to see if we are using a specific path for vswhere
    let vswhereToolExe = ''

    if (VSWHERE_PATH) {
      // specified a path for vswhere, use it
      core.debug(`Using given vswhere-path: ${VSWHERE_PATH}`)
      vswhereToolExe = path.join(VSWHERE_PATH, 'vswhere.exe')
    } else {
      // check in PATH to see if it is there
      try {
        const vsWhereInPath: string = await io.which('vswhere', true)
        core.debug(`Found tool in PATH: ${vsWhereInPath}`)
        vswhereToolExe = vsWhereInPath
      } catch {
        // fall back to VS-installed path
        vswhereToolExe = path.join(
          process.env['ProgramFiles(x86)'] as string,
          'Microsoft Visual Studio\\Installer\\vswhere.exe'
        )
        core.debug(`Trying Visual Studio-installed path: ${vswhereToolExe}`)
      }
    }

    if (!fs.existsSync(vswhereToolExe)) {
      core.setFailed(
        'Lectem/vswhere requires the path to where vswhere.exe exists'
      )

      return
    }

    core.debug(`Full tool exe: ${vswhereToolExe}`)

    // execute the find, vswhere prints one line per matching file
    const matches = await runVswhere(vswhereToolExe, VSWHERE_EXEC)
    const candidates = matches
      .filter(match => fs.existsSync(path.parse(match).dir))
      .map(classify)

    const wanted =
      ARCHITECTURE === 'any'
        ? undefined
        : ARCHITECTURE === 'host'
        ? hostArchitecture()
        : ARCHITECTURE

    // `host` drops what this machine cannot execute, an explicitly requested
    // architecture is taken as the caller knowing better
    const runnable = RUNNABLE[hostArchitecture()] || []
    const usable =
      ARCHITECTURE === 'host'
        ? candidates.filter(
            candidate =>
              candidate.host === undefined || runnable.includes(candidate.host)
          )
        : candidates

    const sorted = usable.slice().sort(compare(wanted))
    const foundFile = sorted.length > 0 ? sorted[0].path : undefined

    // an explicitly requested architecture is not a preference, falling back to
    // another one would hand over a file that cannot do what was asked
    if (
      foundFile !== undefined &&
      wanted !== undefined &&
      ARCHITECTURE !== 'host' &&
      preferenceRank(sorted[0].host, wanted) === 2 &&
      preferenceRank(sorted[0].target, wanted) === 2
    ) {
      core.setFailed(
        `No ${ARCHITECTURE} match for ${FILE}, only:\n${matches.join('\n')}`
      )

      return
    }

    if (!foundFile && candidates.length > 0) {
      // something matched, but running it here would fail
      core.setFailed(
        `Every match for ${FILE} is built for another architecture, ` +
          `this runner is ${hostArchitecture()}:\n${matches.join('\n')}\n` +
          'Narrow the pattern down, or set `architecture` to the one you ' +
          'want, or to `any` to disable the check.'
      )

      return
    }

    if (!foundFile) {
      // the file was not found, report what was actually searched so that the
      // failure can be told apart from "no Visual Studio instance matched"
      const instances = await runVswhere(
        vswhereToolExe,
        `${VSWHERE_SELECT} -property installationPath`
      )

      if (instances.length === 0) {
        core.setFailed(
          `No Visual Studio instance matched \`${VSWHERE_SELECT}\`. ` +
            'Check the `vs-version`, `requires` and `vs-prerelease` inputs.'
        )
      } else {
        core.setFailed(
          `Unable to find ${FILE} in ${instances.join(', ')}. ` +
            'The layout of an installation changes between Visual Studio ' +
            'versions, a wildcard pattern such as `**\\clang-tidy.exe` is ' +
            'less likely to break.'
        )
      }

      return
    }

    if (matches.length > 1) {
      core.info(`Found several matches for ${FILE}:\n${matches.join('\n')}`)
      core.info(`Using ${foundFile}`)
    }

    // the architecture told the two apart, the rest of the ordering is
    // arbitrary and should not be relied upon
    if (
      sorted.length > 1 &&
      preferenceRank(sorted[0].host, wanted) ===
        preferenceRank(sorted[1].host, wanted) &&
      preferenceRank(sorted[0].target, wanted) ===
        preferenceRank(sorted[1].target, wanted)
    ) {
      core.warning(
        `${FILE} matches several equally good files, using ${foundFile}. ` +
          `Narrow the pattern down to pick between them:\n${sorted
            .map(candidate => candidate.path)
            .join('\n')}`
      )
    }

    const foundFileDir = path.parse(foundFile).dir
    core.debug(`Found file installation path: ${foundFileDir}`)

    // set the outputs for the action to the folder path of the file
    core.setOutput('filePath', foundFileDir)

    // add tool path to PATH
    core.addPath(foundFileDir)
    core.debug(`Tool path added to PATH: ${foundFileDir}`)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
