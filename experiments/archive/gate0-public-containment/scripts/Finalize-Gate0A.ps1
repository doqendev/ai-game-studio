[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RunRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Gate0-Evidence.ps1')
$RunRoot = Assert-Gate0RunRoot -RunRoot $RunRoot
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$gate0Root = Join-Path $sourceRoot 'gate0'
$reportsRoot = Join-Path $RunRoot 'reports'

$protocolGeneration = Get-Content -Raw -LiteralPath (Join-Path $RunRoot 'protocol\codex-0.144.5\protocol-generation.json') | ConvertFrom-Json
$protocol = Get-Content -Raw -LiteralPath (Join-Path $RunRoot 'protocol\protocol-compatibility.json') | ConvertFrom-Json
$authentication = Get-Content -Raw -LiteralPath (Join-Path $RunRoot 'auth\auth-report.json') | ConvertFrom-Json
$processes = Get-Content -Raw -LiteralPath (Join-Path $RunRoot 'process-supervision\process-supervision.json') | ConvertFrom-Json

if (-not ($protocolGeneration.pass -and $protocol.pass -and $authentication.pass -and $processes.pass)) {
    throw 'Gate 0A cannot be finalized because at least one hard-gate report is not passing.'
}

$failed = @($protocol.results + $authentication.results + $processes.results | Where-Object { -not $_.pass })
if ($failed.Count -ne 0) {
    throw "Gate 0A contains failed final probes: $($failed.id -join ', ')"
}

$secretPatterns = @(
    'https://auth',
    'verificationUrl"\s*:\s*"(?!\[redacted\])',
    'authUrl"\s*:\s*"(?!\[redacted\])',
    'userCode"\s*:\s*"(?!\[redacted\])',
    'accessToken"\s*:\s*"(?!\[redacted\])',
    'apiKey"\s*:\s*"(?!\[redacted\])'
)
$sanitizedReports = @(
    (Join-Path $RunRoot 'auth\auth-report.json'),
    (Join-Path $RunRoot 'protocol\protocol-compatibility.json'),
    (Join-Path $RunRoot 'process-supervision\process-supervision.json')
)
$secretHits = @(Select-String -LiteralPath $sanitizedReports -Pattern $secretPatterns -AllMatches)
if ($secretHits.Count -ne 0) {
    throw 'Sanitized Gate 0A reports contain a reusable credential or URL pattern.'
}

Add-Gate0Event -RunRoot $RunRoot -Type 'stage.gate0a.completed' -Status 'pass' -Data ([ordered]@{
    protocolTests = $protocol.results.Count
    authenticationTests = $authentication.results.Count
    processTests = $processes.results.Count
    nextStage = 'Gate 0B'
    milestone1Authorized = $false
})

$eventSnapshot = Join-Path $reportsRoot 'gate0a-events.jsonl'
Copy-Item -LiteralPath (Join-Path $RunRoot 'events.jsonl') -Destination $eventSnapshot -Force

$scorecardLines = New-Object System.Collections.Generic.List[string]
$scorecardLines.Add('# Gate 0A scorecard')
$scorecardLines.Add('')
$scorecardLines.Add('**Decision: GO to Gate 0B only. Product implementation and Milestone 1 remain blocked.**')
$scorecardLines.Add('')
$scorecardLines.Add("Completed: $((Get-Date).ToUniversalTime().ToString('o'))")
$scorecardLines.Add('')
$scorecardLines.Add('## Hard-gate results')
$scorecardLines.Add('')
$scorecardLines.Add('| Probe | Result |')
$scorecardLines.Add('|---|---|')
foreach ($result in @($protocol.results + $authentication.results + $processes.results)) {
    $scorecardLines.Add("| $($result.id) - $($result.name.Replace('|', '\|')) | PASS |")
}
$scorecardLines.Add('')
$scorecardLines.Add('## Confirmed on this machine')
$scorecardLines.Add('')
$scorecardLines.Add('- Codex 0.144.5 was pinned by exact version and SHA-256; global Codex 0.143.0 was rejected before launch.')
$scorecardLines.Add('- Stable generated output was requested without `--experimental`: 598 TypeScript files and 266 individual JSON schemas repeated byte-for-byte. The aggregate schema bundle is semantically equal after canonical object-key ordering, but its definition order is nondeterministic.')
$scorecardLines.Add('- The actual stdio App Server initialized through the Job Object helper and reported the exact isolated `CODEX_HOME`. Pre-initialize and unknown requests failed explicitly; the adapter blocked `command/exec` outside a dedicated internal probe.')
$scorecardLines.Add('- Device-code login could be started and canceled. Browser ChatGPT login completed in a fresh file-backed managed home, survived App Server restart, logged out, removed the isolated credential file, and left the pre-existing global ChatGPT login unchanged.')
$scorecardLines.Add('- Detached descendants survived ordinary parent termination, but Job Object close and owner-process death removed the full tree. A real App Server child was also removed.')
$scorecardLines.Add('- Infinite CPU was terminated by duration. Aggregate memory growth terminated at 115,277,824 bytes under a 134,217,728-byte declared test limit, using an 80% high-water response and 90% OS hard cap.')
$scorecardLines.Add('- Oversized frames, sustained event flooding, and unresponsive requests terminated or timed out without replay.')
$scorecardLines.Add('')
$scorecardLines.Add('## Corrections retained as evidence')
$scorecardLines.Add('')
$scorecardLines.Add('- The first schema probe incorrectly required byte-stable aggregate object-key ordering; its failed packet is retained.')
$scorecardLines.Add('- Two flood fixtures undershot the declared rate because of Windows timer granularity; both failed attempts are retained. The final full-window test exceeded 1,250 events over five seconds and passed containment.')
$scorecardLines.Add('- The first two process baselines omitted the documented Windows detached-process condition; both failed attempts are retained.')
$scorecardLines.Add('- The initial authentication ACL ordering made its own config unreadable before authentication began. That home and report are retained; the corrected empty-directory-first ACL flow passed.')
$scorecardLines.Add('- The first memory calibration terminated correctly but sampled above the declared test ceiling. Its report is retained; the margin-corrected probe remained below the declared ceiling.')
$scorecardLines.Add('')
$scorecardLines.Add('## Residual risks and hypotheses')
$scorecardLines.Add('')
$scorecardLines.Add('- The `app-server` command and schema generators are still labeled experimental by the pinned CLI even though stable output was generated without the experimental flag. Automatic upgrades remain prohibited.')
$scorecardLines.Add('- The aggregate JSON Schema bundle has nondeterministic definition ordering. Consumers must use individual schemas or canonical semantic comparison, not bundle byte hashes across regeneration.')
$scorecardLines.Add('- Authentication was proven for this consumer ChatGPT account and Windows profile, not enterprise credential policies, roaming profiles, or offline sign-in.')
$scorecardLines.Add('- The Job Object mechanism was tested at a 128 MiB hostile limit and with the real App Server. Product-specific 2 GiB tuning remains a later implementation value, not a claim that every workload fits it.')
$scorecardLines.Add('- Gate 0A does not prove Builder sandbox containment, snapshots, crash-state recovery, Godot containment, or a review runtime. Those are Gate 0B/0C.')
$scorecardLines.Add('')
$scorecardLines.Add('## Official sources used')
$scorecardLines.Add('')
$scorecardLines.Add('- OpenAI Codex App Server: https://learn.chatgpt.com/docs/app-server')
$scorecardLines.Add('- OpenAI authentication and credential storage: https://learn.chatgpt.com/docs/auth#credential-storage')
$scorecardLines.Add('- OpenAI config/state locations: https://learn.chatgpt.com/docs/config-file/config-advanced#config-and-state-locations')
$scorecardLines.Add('- Microsoft Job Objects: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects')
$scorecardLines.Add('- Microsoft extended Job Object limits: https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information')
$scorecardLines.Add('- Node child-process detached behavior: https://nodejs.org/api/child_process.html#optionsdetached')
$scorecardLines.Add('')
$scorecardLines.Add('## Stage decision')
$scorecardLines.Add('')
$scorecardLines.Add('Gate 0A passes. Proceed to Gate 0B with the same pinned binary, schema bundle, managed authentication home pattern, output/event caps, and no-daemon Job Object helper. This is not authorization for Gate 0C, product UI, MVP role orchestration, or Milestone 1.')

$scorecardPath = Join-Path $reportsRoot 'gate-0a-scorecard.md'
[System.IO.File]::WriteAllLines($scorecardPath, $scorecardLines, [System.Text.UTF8Encoding]::new($false))

$stageResult = [ordered]@{
    schemaVersion = 1
    stage = 'Gate 0A'
    status = 'pass'
    decision = 'go-to-gate-0b-only'
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    tests = [ordered]@{
        protocol = [ordered]@{ passed = $protocol.results.Count; failed = 0 }
        authentication = [ordered]@{ passed = $authentication.results.Count; failed = 0 }
        processSupervision = [ordered]@{ passed = $processes.results.Count; failed = 0 }
    }
    productImplementationAuthorized = $false
    milestone1Authorized = $false
}
$stageResultPath = Join-Path $reportsRoot 'gate0a-result.json'
Write-Gate0JsonAtomic -Path $stageResultPath -Value $stageResult

$manifestEntries = New-Object System.Collections.Generic.List[object]
$evidenceFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $RunRoot 'protocol\codex-0.144.5') -Recurse -File |
        Where-Object { $_.FullName -notmatch 'schema-codex-home' }
    Get-ChildItem -LiteralPath (Join-Path $RunRoot 'protocol') -File
    Get-ChildItem -LiteralPath (Join-Path $RunRoot 'auth') -File
    Get-ChildItem -LiteralPath (Join-Path $RunRoot 'process-supervision') -File
    Get-Item -LiteralPath (Join-Path $RunRoot 'environment.json')
    Get-Item -LiteralPath $eventSnapshot
    Get-Item -LiteralPath $scorecardPath
    Get-Item -LiteralPath $stageResultPath
) | Sort-Object FullName -Unique
foreach ($file in $evidenceFiles) {
    $manifestEntries.Add([ordered]@{
        scope = 'evidence'
        path = $file.FullName.Substring($RunRoot.Length).TrimStart('\').Replace('\', '/')
        size = $file.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    })
}

$sourceFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $gate0Root 'src') -Recurse -File
    Get-ChildItem -LiteralPath (Join-Path $gate0Root 'scripts') -Recurse -File
    Get-ChildItem -LiteralPath (Join-Path $gate0Root 'native') -Recurse -File
    Get-ChildItem -LiteralPath (Join-Path $gate0Root 'fixtures') -Recurse -File
    Get-Item -LiteralPath (Join-Path $gate0Root 'package.json')
    Get-Item -LiteralPath (Join-Path $gate0Root 'package-lock.json')
    Get-Item -LiteralPath (Join-Path $gate0Root 'tsconfig.json')
    Get-Item -LiteralPath (Join-Path $gate0Root 'build\native\JobSupervisor.exe')
) | Sort-Object FullName -Unique
foreach ($file in $sourceFiles) {
    $manifestEntries.Add([ordered]@{
        scope = 'probe-source'
        path = $file.FullName.Substring($sourceRoot.Length).TrimStart('\').Replace('\', '/')
        size = $file.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    })
}

$manifestPath = Join-Path $reportsRoot 'gate0a-evidence-manifest.json'
Write-Gate0JsonAtomic -Path $manifestPath -Value ([ordered]@{
    schemaVersion = 1
    stage = 'Gate 0A'
    sealedAt = (Get-Date).ToUniversalTime().ToString('o')
    excludes = @('raw credential values', 'managed CODEX_HOME runtime files', 'reusable authentication URLs and codes')
    entries = $manifestEntries
})

$runManifestPath = Join-Path $RunRoot 'run.json'
$runManifest = Get-Content -Raw -LiteralPath $runManifestPath | ConvertFrom-Json
$updatedRun = [ordered]@{}
foreach ($property in $runManifest.PSObject.Properties) { $updatedRun[$property.Name] = $property.Value }
$updatedRun.stage = 'Gate 0B'
$updatedRun.status = 'running'
$updatedRun.completedStages = @('Gate 0A')
$updatedRun.gate0aResult = 'reports/gate0a-result.json'
$updatedRun.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
Write-Gate0JsonAtomic -Path $runManifestPath -Value $updatedRun

$activePath = Join-Path (Split-Path (Split-Path $RunRoot -Parent) -Parent) 'active-run.json'
Write-Gate0JsonAtomic -Path $activePath -Value ([ordered]@{
    runId = $runManifest.runId
    stage = 'Gate 0B'
    status = 'running'
    evidenceRoot = $RunRoot
    completedStages = @('Gate 0A')
    updatedAt = $updatedRun.updatedAt
})

@($scorecardPath, $stageResultPath, $eventSnapshot, $manifestPath) | ForEach-Object {
    (Get-Item -LiteralPath $_).IsReadOnly = $true
}

$scorecardPath
