[CmdletBinding()]
param(
    [string]$RunId
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$gateRoot = Join-Path $env:LOCALAPPDATA 'AI Game Studio\Gate0'
$runsRoot = Join-Path $gateRoot 'runs'

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $random = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $RunId = "$stamp-$random-gate0a"
}

$runRoot = Join-Path $runsRoot $RunId
if (Test-Path -LiteralPath $runRoot) {
    throw "Gate 0 run already exists: $runRoot"
}

@(
    $gateRoot,
    $runsRoot,
    $runRoot,
    (Join-Path $runRoot 'raw'),
    (Join-Path $runRoot 'protocol'),
    (Join-Path $runRoot 'auth'),
    (Join-Path $runRoot 'process-supervision'),
    (Join-Path $runRoot 'reports')
) | ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $temporary = "$Path.tmp-$([Guid]::NewGuid().ToString('N'))"
    $json = $Value | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

$requirementsPath = Join-Path $sourceRoot 'AI_Game_Studio_Critical_Technical_Response_and_Gate_0_Feasibility_Design.md'
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$manifest = [ordered]@{
    schemaVersion = 1
    runId = $RunId
    stage = 'Gate 0A'
    status = 'running'
    startedAt = $startedAt
    sourceRoot = $sourceRoot
    evidenceRoot = $runRoot
    requirements = [ordered]@{
        path = $requirementsPath
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $requirementsPath).Hash.ToLowerInvariant()
    }
    scope = @(
        'pinned App Server protocol',
        'matching generated schemas',
        'isolated authentication',
        'Windows process-tree supervision'
    )
    blockedScope = @(
        'Gate 0B',
        'Gate 0C',
        'product UI',
        'MVP orchestration',
        'Milestone 1'
    )
}

Write-JsonAtomic -Path (Join-Path $runRoot 'run.json') -Value $manifest
Write-JsonAtomic -Path (Join-Path $gateRoot 'active-run.json') -Value ([ordered]@{
    runId = $RunId
    stage = 'Gate 0A'
    status = 'running'
    evidenceRoot = $runRoot
    updatedAt = $startedAt
})

$initialEvent = [ordered]@{
    seq = 1
    at = $startedAt
    stage = 'Gate 0A'
    type = 'run.initialized'
    status = 'running'
    data = [ordered]@{
        requirementsSha256 = $manifest.requirements.sha256
        sourceRoot = $sourceRoot
    }
}
[System.IO.File]::AppendAllText(
    (Join-Path $runRoot 'events.jsonl'),
    (($initialEvent | ConvertTo-Json -Depth 20 -Compress) + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
)

$runRoot

