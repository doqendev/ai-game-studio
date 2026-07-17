[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RunRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Gate0-Evidence.ps1')
$RunRoot = Assert-Gate0RunRoot -RunRoot $RunRoot
$gate0Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = (Resolve-Path (Join-Path $gate0Root '..')).Path

$pinnedCodex = Join-Path $gate0Root 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$globalCodexCommand = Get-Command codex -ErrorAction Stop
$globalCodexLauncher = $globalCodexCommand.Source
$globalCodexLauncherItem = Get-Item -LiteralPath $globalCodexLauncher -Force
$globalCodexExe = if ($globalCodexLauncherItem.LinkType -eq 'SymbolicLink' -and $globalCodexLauncherItem.Target) {
    [string]$globalCodexLauncherItem.Target[0]
} else {
    $globalCodexLauncher
}
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$supervisor = Join-Path $gate0Root 'build\native\JobSupervisor.exe'
$requirements = Join-Path $sourceRoot 'AI_Game_Studio_Critical_Technical_Response_and_Gate_0_Feasibility_Design.md'

function Invoke-CapturedNative {
    param([Parameter(Mandatory = $true)][scriptblock]$Command)

    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        return (& $Command 2>&1 | Out-String).Trim()
    } finally {
        $ErrorActionPreference = $prior
    }
}

$operatingSystem = Get-CimInstance Win32_OperatingSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$environment = [ordered]@{
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    host = [ordered]@{
        osCaption = $operatingSystem.Caption
        osVersion = $operatingSystem.Version
        osBuild = $operatingSystem.BuildNumber
        osArchitecture = $operatingSystem.OSArchitecture
        processorArchitecture = $env:PROCESSOR_ARCHITECTURE
        processor = $processor.Name
        logicalProcessors = $processor.NumberOfLogicalProcessors
        powershell = $PSVersionTable.PSVersion.ToString()
        node = Invoke-CapturedNative { node --version }
        npm = Invoke-CapturedNative { npm --version }
        sourceVolume = (Get-Volume -DriveLetter ([System.IO.Path]::GetPathRoot($sourceRoot).Substring(0,1))).FileSystem
        evidenceVolume = (Get-Volume -DriveLetter ([System.IO.Path]::GetPathRoot($RunRoot).Substring(0,1))).FileSystem
    }
    codex = [ordered]@{
        pinnedVersionOutput = Invoke-CapturedNative { & $pinnedCodex --version }
        pinnedBinary = Get-Gate0FileIdentity -Path $pinnedCodex
        packageJson = Get-Gate0FileIdentity -Path (Join-Path $gate0Root 'package.json')
        packageLock = Get-Gate0FileIdentity -Path (Join-Path $gate0Root 'package-lock.json')
        globalVersionOutput = Invoke-CapturedNative { codex --version }
        globalCommandPath = $globalCodexLauncher
        globalBinary = Get-Gate0FileIdentity -Path $globalCodexExe
        globalLoginStatus = (& cmd.exe /d /c "codex login status 2>&1" | Out-String).Trim()
    }
    nativeHelper = [ordered]@{
        compiler = Get-Gate0FileIdentity -Path $compiler
        source = Get-Gate0FileIdentity -Path (Join-Path $gate0Root 'native\JobSupervisor.cs')
        executable = Get-Gate0FileIdentity -Path $supervisor
    }
    contract = Get-Gate0FileIdentity -Path $requirements
}

$path = Join-Path $RunRoot 'environment.json'
Write-Gate0JsonAtomic -Path $path -Value $environment
Add-Gate0Event -RunRoot $RunRoot -Type 'environment.captured' -Status 'pass' -Data ([ordered]@{
    evidence = 'environment.json'
    pinnedCodex = $environment.codex.pinnedVersionOutput
    pinnedSha256 = $environment.codex.pinnedBinary.sha256
    supervisorSha256 = $environment.nativeHelper.executable.sha256
})

$path
