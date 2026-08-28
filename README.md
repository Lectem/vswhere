# Lectem/vswhere

This action will help finding any file installed in Visual Studio. This is based on the [setup-msbuild](https://github.com/microsoft/setup-msbuild) action.
It will add said file directory to the PATH.

> Note: tested on the `windows-2022`, `windows-2025` and `windows-2025-vs2026`
> runner images, see [the workflow](.github/workflows/test.yml).

## Example Usage

```yml
- name: Add VS bundled clang-tidy to PATH
  uses: Lectem/vswhere@v1
  with: { file: '**\clang-tidy.exe' }

- name: Build app for release
  run: clang-tidy --version
```

## The `file` parameter

The action will add ot the path the directory containing the matching file under the installation path. 
It will look recursively through folders.'
- `?`  Matches any one character except `\`
- `*`  Matches zero or more characters except `\`
- `**` Searches the current directory and subdirectories for the remaining search pattern

Prefer a wildcard over a full path: Visual Studio moves files around between
versions, so `VC\Tools\Llvm\bin\clang-tidy.exe` may find nothing on a newer
installation while `**\clang-tidy.exe` still does.

When a pattern matches several files, the action logs all of them and picks one,
see [Picking between architectures](#picking-between-architectures).

## Picking between architectures

Visual Studio ships the same tool several times, once per architecture. On a
2022 installation `**\clang-tidy.exe` matches all three of:

```
VC\Tools\Llvm\ARM64\bin\clang-tidy.exe
VC\Tools\Llvm\bin\clang-tidy.exe
VC\Tools\Llvm\x64\bin\clang-tidy.exe
```

The action logs every match and then picks one, in this order:

1. copies built for the wanted architecture, which defaults to the one of the
   runner, so an x64 runner gets `Llvm\x64\bin`
2. copies whose path says nothing about architecture, here `Llvm\bin`
3. anything left, closest to the runner first
4. the shortest path, then the newest version, so `**\cl.exe` uses the latest
   `VC\Tools\MSVC\<version>` toolset rather than an older one left over

**Copies the runner cannot execute are never picked.** An arm64 build is not
selected on an x64 runner even when it is the only match, the action fails and
lists what it found instead of putting something unusable in the PATH. The
directory names the *host* architecture, the one the file runs on, not the one
it produces code for: `VC\Tools\MSVC\<version>\bin\Hostx64\arm64\cl.exe` is an
x64 program that emits arm64 code.

If several matches are still equally good the pick is arbitrary, and the action
warns. Narrow the pattern down rather than relying on the order.

Use the `architecture` input to ask for something other than the runner:

```yml
  with:
    file: '**\cl.exe'
    architecture: 'arm64'  # host (default), any, x86, x64, arm or arm64
```

An explicit architecture is a requirement, not a preference: the action fails
rather than falling back to a different one. `any` disables all of it,
including the check that the file can run at all.

## Optional Parameters
There are a few additional parameters that can be set if you need them. These are optional and should only be set if you know that you need them or what you are doing.

### Specifying specific versions of Visual Studio (optional)
You may have a situation where your Actions runner has multiple versions of Visual Studio and you need to find a specific version of the tool.  Simply add the `vs-version` input to specify the range of versions to find.  If looking for a specific version, specify the minimum and maximum versions as shown in the example below, which will look for just 16.4.

```yml
- name: Add VS bundled clang-tidy to PATH
  uses: Lectem/vswhere@v1
  with:
    file: '**\clang-tidy.exe'
    vs-version: '[16.4,16.5)'
```

The syntax is the same used for Visual Studio extensions, where square brackets like "[" mean inclusive, and parenthesis like "(" mean exclusive. A comma is always required, but eliding the minimum version looks for all older versions and eliding the maximum version looks for all newer versions. See the [vswhere wiki](https://github.com/microsoft/vswhere/wiki) for more details.

### Use pre-release versions of Visual Studio (optional)
If you need your Actions runner to target a pre-release version of Visual Studio, simply add the `vs-prerelease` input.  This is necessary if you want to run an action on a virtual environment that contains a pre-release version of Visual Studio or self-hosted images that you may have that also have pre-release versions of Visual Studio installed.

```yml
  with:
    vs-prerelease: true
```
### Specifying required components

You may specify the required components using the `requires` input.
It expects a string containing the list of components seperated by spaces.

```yml
  with:
    requires: 'Microsoft.VisualStudio.Workload.NativeDesktop Microsoft.VisualStudio.Component.Windows10SDK.*'
```

 See [https://aka.ms/vs/workloads](https://aka.ms/vs/workloads) for a list of workload and component IDs.

You may also specify that it only needs one of the components by setting `requires-any` to `true`.

```yml
  with:
    requires: 'Component.Android.SDK22 Component.Android.SDK23'
    requires-any: true
```

### Specifying vswhere location
This makes use of the vswhere tool which is a tool delivered by Microsoft to help in identifying Visual Studio installs and various components.  This tool is installed on the hosted Windows runners for GitHub Actions.  If you are using a self-hosted runner, you either need to make sure vswhere.exe is in your agent's PATH or specify a full path to the location using:

```yml
  with:
    vswhere-path: 'C:\path\to\your\tools\'
```


## Building this repo
As with most GitHub Actions, this requires NodeJS development tools.  After installing NodeJS, you can build this by executing:

```bash
npm install
npm run build
npm run pack
```

which will modify/create the /dist folder with the final index.js output

# Credits
Thank you to [Warren Buckley](https://github.com/warrenbuckley) for being a core contributor to the MSBuild Action for the benefit of all developers!

