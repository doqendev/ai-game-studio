[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RunRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Gate0-Evidence.ps1')
$RunRoot = Assert-Gate0RunRoot -RunRoot $RunRoot
$gate0Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$codex = Join-Path $gate0Root 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$protocolRoot = Join-Path $RunRoot 'protocol\codex-0.144.5'
$typesRoot = Join-Path $protocolRoot 'typescript'
$schemaRoot = Join-Path $protocolRoot 'json-schema'
$repeatRoot = Join-Path $protocolRoot 'repeat-generation'
$schemaHome = Join-Path $protocolRoot 'schema-codex-home'

New-Item -ItemType Directory -Path $protocolRoot, $schemaHome -Force | Out-Null

function Quote-ProcessArgument {
    param([string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-CappedProcess {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [int]$TimeoutMilliseconds = 30000
    )

    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['CODEX_HOME'] = $schemaHome
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    $startedAt = (Get-Date).ToUniversalTime()
    if (-not $process.Start()) { throw "Failed to launch $Executable" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        $process.Kill()
        $process.WaitForExit()
        throw "Process timed out after $TimeoutMilliseconds ms: $Executable $($start.Arguments)"
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($stdout.Length -gt 8MB -or $stderr.Length -gt 8MB) {
        throw 'Protocol generator exceeded the 8 MiB stream limit.'
    }
    return [ordered]@{
        executable = $Executable
        arguments = $Arguments
        codexHome = $schemaHome
        startedAt = $startedAt.ToString('o')
        durationMs = [math]::Round(((Get-Date).ToUniversalTime() - $startedAt).TotalMilliseconds)
        exitCode = $process.ExitCode
        stdout = $stdout
        stderr = $stderr
    }
}

function Get-DirectoryManifest {
    param([string]$Root)
    return @(
        Get-ChildItem -LiteralPath $Root -Recurse -File |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = $_.FullName.Substring($Root.Length).TrimStart('\').Replace('\', '/')
                    size = $_.Length
                    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
                }
            }
    )
}

function ConvertTo-CanonicalJsonNode {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [System.Collections.IDictionary]) {
        $ordered = [ordered]@{}
        foreach ($key in @($Value.Keys | Sort-Object)) {
            $ordered[$key] = ConvertTo-CanonicalJsonNode $Value[$key]
        }
        return $ordered
    }
    if ($Value -is [pscustomobject]) {
        $ordered = [ordered]@{}
        foreach ($property in @($Value.PSObject.Properties | Sort-Object Name)) {
            $ordered[$property.Name] = ConvertTo-CanonicalJsonNode $property.Value
        }
        return $ordered
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value | ForEach-Object { ConvertTo-CanonicalJsonNode $_ })
    }
    return $Value.ToString()
}

Add-Gate0Event -RunRoot $RunRoot -Type 'protocol.generation.started' -Status 'running' -Data ([ordered]@{
    pinnedVersion = '0.144.5'
    includeExperimental = $false
})

$version = Invoke-CappedProcess -Executable $codex -Arguments @('--version')
$help = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', '--help')
$typeHelp = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', 'generate-ts', '--help')
$schemaHelp = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', 'generate-json-schema', '--help')

if (Test-Path -LiteralPath $typesRoot) { Remove-Item -LiteralPath $typesRoot -Recurse -Force }
if (Test-Path -LiteralPath $schemaRoot) { Remove-Item -LiteralPath $schemaRoot -Recurse -Force }
if (Test-Path -LiteralPath $repeatRoot) { Remove-Item -LiteralPath $repeatRoot -Recurse -Force }
New-Item -ItemType Directory -Path $typesRoot, $schemaRoot, (Join-Path $repeatRoot 'typescript'), (Join-Path $repeatRoot 'json-schema') -Force | Out-Null

$generateTypes = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', 'generate-ts', '--out', $typesRoot)
$generateSchema = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', 'generate-json-schema', '--out', $schemaRoot)
$repeatTypes = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', 'generate-ts', '--out', (Join-Path $repeatRoot 'typescript'))
$repeatSchema = Invoke-CappedProcess -Executable $codex -Arguments @('app-server', 'generate-json-schema', '--out', (Join-Path $repeatRoot 'json-schema'))

$typeManifest = Get-DirectoryManifest -Root $typesRoot
$schemaManifest = Get-DirectoryManifest -Root $schemaRoot
$repeatTypeManifest = Get-DirectoryManifest -Root (Join-Path $repeatRoot 'typescript')
$repeatSchemaManifest = Get-DirectoryManifest -Root (Join-Path $repeatRoot 'json-schema')

$typeDeterministic = (ConvertTo-Json $typeManifest -Depth 10 -Compress) -eq (ConvertTo-Json $repeatTypeManifest -Depth 10 -Compress)
$schemaByteDeterministic = (ConvertTo-Json $schemaManifest -Depth 10 -Compress) -eq (ConvertTo-Json $repeatSchemaManifest -Depth 10 -Compress)
$bundleName = 'codex_app_server_protocol.v2.schemas.json'
$individualSchemaManifest = @($schemaManifest | Where-Object { $_.path -ne $bundleName })
$repeatIndividualSchemaManifest = @($repeatSchemaManifest | Where-Object { $_.path -ne $bundleName })
$individualSchemasByteDeterministic = (ConvertTo-Json $individualSchemaManifest -Depth 10 -Compress) -eq (ConvertTo-Json $repeatIndividualSchemaManifest -Depth 10 -Compress)
$bundleFirst = Get-Content -Raw -LiteralPath (Join-Path $schemaRoot $bundleName) | ConvertFrom-Json
$bundleRepeat = Get-Content -Raw -LiteralPath (Join-Path (Join-Path $repeatRoot 'json-schema') $bundleName) | ConvertFrom-Json
$canonicalBundleFirst = ConvertTo-CanonicalJsonNode $bundleFirst | ConvertTo-Json -Depth 100 -Compress
$canonicalBundleRepeat = ConvertTo-CanonicalJsonNode $bundleRepeat | ConvertTo-Json -Depth 100 -Compress
$bundleSemanticallyEquivalent = $canonicalBundleFirst -ceq $canonicalBundleRepeat
$allInvocations = @($version, $help, $typeHelp, $schemaHelp, $generateTypes, $generateSchema, $repeatTypes, $repeatSchema)
$allExitZero = @($allInvocations | Where-Object { $_.exitCode -ne 0 }).Count -eq 0
$experimentalWasRequested = @($allInvocations | ForEach-Object { $_.arguments } | Where-Object { $_ -eq '--experimental' }).Count -ne 0
$versionMatches = $version.stdout.Trim() -eq 'codex-cli 0.144.5'

$report = [ordered]@{
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    pinnedBinary = Get-Gate0FileIdentity -Path $codex
    expectedVersion = 'codex-cli 0.144.5'
    observedVersion = $version.stdout.Trim()
    stableGeneration = [ordered]@{
        experimentalFlagRequested = $experimentalWasRequested
        generatorCommandMarkedExperimentalByCli = $help.stdout.Contains('[experimental]')
        types = [ordered]@{
            count = $typeManifest.Count
            deterministicRepeat = $typeDeterministic
            files = $typeManifest
        }
        jsonSchema = [ordered]@{
            count = $schemaManifest.Count
            byteDeterministicRepeat = $schemaByteDeterministic
            individualFilesByteDeterministicRepeat = $individualSchemasByteDeterministic
            aggregateBundleSemanticEquivalent = $bundleSemanticallyEquivalent
            aggregateBundleOrderingVaries = (-not $schemaByteDeterministic -and $individualSchemasByteDeterministic -and $bundleSemanticallyEquivalent)
            files = $schemaManifest
        }
    }
    commands = $allInvocations
    pass = ($allExitZero -and $versionMatches -and -not $experimentalWasRequested -and $typeDeterministic -and $individualSchemasByteDeterministic -and $bundleSemanticallyEquivalent -and $typeManifest.Count -gt 0 -and $schemaManifest.Count -gt 0)
}

$reportPath = Join-Path $protocolRoot 'protocol-generation.json'
Write-Gate0JsonAtomic -Path $reportPath -Value $report
Write-Gate0JsonAtomic -Path (Join-Path $protocolRoot 'typescript-manifest.json') -Value $typeManifest
Write-Gate0JsonAtomic -Path (Join-Path $protocolRoot 'json-schema-manifest.json') -Value $schemaManifest

$status = if ($report.pass) { 'pass' } else { 'fail' }
Add-Gate0Event -RunRoot $RunRoot -Type 'protocol.generation.completed' -Status $status -Data ([ordered]@{
    evidence = 'protocol/codex-0.144.5/protocol-generation.json'
    typeFiles = $typeManifest.Count
    schemaFiles = $schemaManifest.Count
    typeFilesByteDeterministic = $typeDeterministic
    individualSchemaFilesByteDeterministic = $individualSchemasByteDeterministic
    aggregateBundleSemanticEquivalent = $bundleSemanticallyEquivalent
    cliLabelsGeneratorExperimental = $report.stableGeneration.generatorCommandMarkedExperimentalByCli
})

if (-not $report.pass) { throw "Protocol generation probe failed. Evidence: $reportPath" }
$reportPath
