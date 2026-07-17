param(
    [Parameter(Mandatory = $true)][string]$SetupRoot,
    [Parameter(Mandatory = $true)][string]$PriorRunRoot
)

$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $SetupRoot).Path
$prior = (Resolve-Path -LiteralPath $PriorRunRoot).Path
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$packet = Join-Path $setup "sealed-pre-remediation-$stamp"
$archive = Join-Path $setup "Gate0B_Loopback_PreRemediation_$stamp.zip"
New-Item -ItemType Directory -Path $packet | Out-Null

function Copy-EvidenceFile {
    param([string]$Source, [string]$Relative)
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
    $destination = Join-Path $packet $Relative
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination
}

Copy-EvidenceFile (Join-Path $setup 'windows-sandbox-setup-report.json') 'setup/windows-sandbox-setup-report.json'
Copy-EvidenceFile (Join-Path $setup 'codex-home/config.toml') 'setup/codex-home-config.toml'
Copy-EvidenceFile (Join-Path $prior 'environment.json') 'prior/environment.json'

Get-ChildItem -LiteralPath $setup -Directory | Where-Object {
    $_.Name -match '(restart-readiness|containment-repeat)$'
} | Sort-Object Name | ForEach-Object {
    $directory = $_
    @(
        'restart-readiness-report.json',
        'sandbox-containment-repeat-report.json',
        'attempt-root/hostile-result.json',
        'attempt-root/allowed-write.txt',
        'outside-attempt-root/sentinel.txt',
        'outside-attempt-root/forbidden-write.txt',
        'outside-attempt-root/junction-forbidden-write.txt'
    ) | ForEach-Object {
        Copy-EvidenceFile (Join-Path $directory.FullName $_) (Join-Path "attempts/$($directory.Name)" $_)
    }
}

$repo = Split-Path -Parent $PSScriptRoot
@(
    'src/app-server-client.ts',
    'src/run-windows-sandbox-setup.ts',
    'src/query-windows-sandbox-readiness.ts',
    'src/run-sandbox-containment-repeat.ts',
    'fixtures/hostile-sandbox-probe.mjs',
    'scripts/Seal-Gate0BLoopbackEvidence.ps1'
) | ForEach-Object {
    Copy-EvidenceFile (Join-Path $repo $_) (Join-Path 'probe-source' $_)
}

$protocol = Join-Path $prior 'protocol/codex-0.144.5'
@(
    'typescript/v2/WindowsSandboxReadinessResponse.ts',
    'typescript/v2/WindowsSandboxSetupCompletedNotification.ts',
    'json-schema/v2/WindowsSandboxReadinessResponse.json',
    'json-schema/v2/WindowsSandboxSetupCompletedNotification.json'
) | ForEach-Object {
    Copy-EvidenceFile (Join-Path $protocol $_) (Join-Path 'protocol' $_)
}

$entries = New-Object System.Collections.Generic.List[object]
Get-ChildItem -LiteralPath $packet -Recurse -File | Sort-Object FullName | ForEach-Object {
    if (-not $_.FullName.StartsWith("$packet\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path escaped packet root: $($_.FullName)"
    }
    $relative = $_.FullName.Substring($packet.Length + 1).Replace('\', '/')
    $entries.Add([ordered]@{
        path = $relative
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    })
}
$manifest = [ordered]@{
    schemaVersion = 1
    purpose = 'Gate 0B Windows sandbox pre-remediation evidence'
    createdAt = [DateTime]::UtcNow.ToString('o')
    priorSealedGate0ArchiveSha256 = '5c162e6afe33684e0469bd1a0e36058820bfaeac8d5b408826e68027cf206f90'
    entries = $entries
}
$manifestPath = Join-Path $packet 'packet-manifest.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $packet 'packet-manifest.sha256') -Value "$manifestHash  packet-manifest.json" -Encoding ascii

Compress-Archive -Path (Join-Path $packet '*') -DestinationPath $archive -CompressionLevel Optimal
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$archive.sha256" -Value "$archiveHash  $([IO.Path]::GetFileName($archive))" -Encoding ascii

[pscustomobject]@{
    packet = $packet
    archive = $archive
    archiveSha256 = $archiveHash
    manifestSha256 = $manifestHash
    evidenceEntryCount = $entries.Count
    archiveSize = (Get-Item -LiteralPath $archive).Length
} | ConvertTo-Json -Depth 4
