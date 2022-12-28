# Lectem/vswhere

This action will help finding any file installed in Visual Studio. This is based on the [setup-msbuild](https://github.com/microsoft/setup-msbuild) action.
It will add said file directory to the PATH.

> Note: This is HIGHLY UNTESTED. USE AT YOUR OWN RISK

## Example Usage

```yml
- name: Add VC++ to PATH
  uses: Lectem/vswhere@v1.0
  with: { file: 'Common7\Tools\VsDevCmd.bat' }

- name: Build app for release
  run: |
    VsDevCmd.bat -arch=x64 -host_arch=x64
    CL.exe
```

## The `file` parameter

The action will add ot the path the directory containing the matching file under the installation path. 
It will look recursively through folders.'
- `?`  Matches any one character except `\`
- `*`  Matches zero or more characters except `\`
- `**` Searches the current directory and subdirectories for the remaining search pattern

## Optional Parameters
There are a few additional parameters that can be set if you need them. These are optional and should only be set if you know that you need them or what you are doing.

### Specifying specific versions of Visual Studio (optional)
You may have a situation where your Actions runner has multiple versions of Visual Studio and you need to find a specific version of the tool.  Simply add the `vs-version` input to specify the range of versions to find.  If looking for a specific version, specify the minimum and maximum versions as shown in the example below, which will look for just 16.4.

```yml
- name: Add VC++ to PATH
  uses: Lectem/vswhere@v1.0
  with:
    file: 'Common7\Tools\VsDevCmd.bat'
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

