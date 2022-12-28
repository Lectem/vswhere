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

// if a specific version of VS is requested
let VSWHERE_EXEC = `-products * -find ${FILE}`

if (REQUIRES !== '') {
  VSWHERE_EXEC += ` -requires ${REQUIRES}`

  if (REQUIRES_ANY) {
    VSWHERE_EXEC += '-requiresAny '
  }
}

if (ALLOW_PRERELEASE === 'true') {
  VSWHERE_EXEC += ' -prerelease'
}

if (VS_VERSION === 'latest') {
  VSWHERE_EXEC += ` -latest`
} else {
  VSWHERE_EXEC += ` -version "${VS_VERSION}"`
}

core.debug(`Execution arguments: ${VSWHERE_EXEC}`)

async function run(): Promise<void> {
  try {
    // exit if non Windows runner
    if (IS_WINDOWS === false) {
      core.setFailed('setup-msbuild can only be run on Windows runners')
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

    let foundFileDir = ''
    const options: ExecOptions = {}
    options.listeners = {
      stdout: (data: Buffer) => {
        const vswhereoutput = data.toString().trim()
        const fileDir = path.parse(vswhereoutput).dir
        if (fs.existsSync(fileDir)) {
          core.debug(`Found file installation path: ${fileDir}`)
          foundFileDir = fileDir
        }
      }
    }

    // execute the find putting the result of the command in the options foundToolPath
    await exec.exec(`"${vswhereToolExe}" ${VSWHERE_EXEC}`, [], options)

    if (!foundFileDir) {
      core.setFailed(`Unable to find ${FILE}.`)
      return
    }

    // set the outputs for the action to the folder path of msbuild
    core.setOutput('filePath', foundFileDir)

    // add tool path to PATH
    core.addPath(foundFileDir)
    core.debug(`Tool path added to PATH: ${foundFileDir}`)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
