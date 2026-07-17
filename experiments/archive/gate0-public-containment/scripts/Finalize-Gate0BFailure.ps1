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
$gate0bRoot = Join-Path $RunRoot 'gate0b'

function Resolve-SafePath {
    param([string]$Path, [string]$Parent)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    return $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)
}

$snapshot = Get-Content -Raw -LiteralPath (Join-Path $gate0bRoot 'snapshot-state\snapshot-and-state-report.json') | ConvertFrom-Json
$sandbox = Get-Content -Raw -LiteralPath (Join-Path $gate0bRoot 'sandbox\sandbox-report.json') | ConvertFrom-Json
$hostilePath = Join-Path $gate0bRoot 'sandbox\attempt-root\hostile-result.json'
$hostile = Get-Content -Raw -LiteralPath $hostilePath | ConvertFrom-Json
$currentPath = Join-Path $gate0bRoot 'snapshot-state\project-store\state\current.A.json'
$current = Get-Content -Raw -LiteralPath $currentPath | ConvertFrom-Json
$activePointer = (Get-Content -Raw -LiteralPath (Join-Path $gate0bRoot 'snapshot-state\project-store\state\active-slot')).Trim()

if (-not $snapshot.pass) { throw 'The passing snapshot-state result required for this failure packet is missing.' }
if ($sandbox.pass) { throw 'This finalizer is only for the observed Gate 0B sandbox hard failure.' }

$liveProbeProcesses = @(
    Get-CimInstance Win32_Process |
        Where-Object { ($_.Name -eq 'JobSupervisor.exe') -or ($_.CommandLine -and $_.CommandLine.Contains($RunRoot)) } |
        Select-Object ProcessId, ParentProcessId, Name, CreationDate, CommandLine
)
if ($liveProbeProcesses.Count -ne 0) {
    throw "Cannot seal Gate 0B while probe processes remain: $($liveProbeProcesses.ProcessId -join ',')"
}

$outsideFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $gate0bRoot 'sandbox\outside-attempt-root') -File |
        Sort-Object Name |
        ForEach-Object {
            [ordered]@{
                name = $_.Name
                size = $_.Length
                sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
            }
        }
)

$failureDetails = [ordered]@{
    schemaVersion = 1
    stage = 'Gate 0B'
    hardFailure = 'Windows command sandbox not configured and not effectively enforced'
    readiness = [ordered]@{
        initial = 'notConfigured'
        elevatedSetupRequested = $true
        waitMilliseconds = 90000
        final = 'notConfigured'
        setupResponseAndCompletionNotificationRetained = $false
        evidenceGap = 'The first harness retained start/final readiness but not the immediate setup response or completion notification. The repeat probe must persist both before waiting.'
    }
    hostileSentinels = [ordered]@{
        insideWriteSucceeded = $hostile.insideWrite.succeeded
        siblingWriteSucceeded = $hostile.outsideWrite.succeeded
        junctionEscapeWriteSucceeded = $hostile.junctionEscapeWrite.succeeded
        childOutsideWriteExitCode = $hostile.childOutsideWrite.exitCode
        localNetworkConnected = $hostile.localNetwork.succeeded
        publicNetworkOutcome = $hostile.publicNetwork.outcome
        outsideReadSucceeded = $hostile.outsideRead.succeeded
        outsideFiles = $outsideFiles
    }
    safety = [ordered]@{
        allEffectsStayedInsideGate0EvidenceRoot = $true
        currentVersion = $current.versionId
        currentSequence = $current.sequence
        currentManifestSha256 = $current.manifestSha256
        activePointerAfterInjectedCorruption = $activePointer
        checksumRecoverySelectedVersion = 'v0001'
        currentVersionChanged = $false
        reviewBuildCreated = $false
        godotStarted = $false
        gate0cStarted = $false
        automaticReplayCount = 0
        remainingProbeProcesses = $liveProbeProcesses.Count
    }
}
$failureDetailsPath = Join-Path $reportsRoot 'gate0b-sandbox-hard-failure.json'
Write-Gate0JsonAtomic -Path $failureDetailsPath -Value $failureDetails

Add-Gate0Event -RunRoot $RunRoot -Type 'stage.gate0b.hard-failure' -Status 'fail' -Data ([ordered]@{
    blocker = 'Windows sandbox readiness remained notConfigured and hostile sentinels escaped workspaceWrite.'
    snapshotTestsPassed = $snapshot.results.Count
    sandboxTestsPassed = @($sandbox.results | Where-Object { $_.pass }).Count
    sandboxTestsFailed = @($sandbox.results | Where-Object { -not $_.pass }).id
    gate0cStarted = $false
    milestone1Authorized = $false
    recommendation = 'revise and repeat named probes'
})

$eventSnapshot = Join-Path $reportsRoot 'gate0b-events.jsonl'
Copy-Item -LiteralPath (Join-Path $RunRoot 'events.jsonl') -Destination $eventSnapshot -Force

$stageResult = [ordered]@{
    schemaVersion = 1
    stage = 'Gate 0B'
    status = 'hard-failure'
    decision = 'stop-before-gate0c'
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    snapshotState = [ordered]@{ passed = $snapshot.results.Count; failed = 0 }
    sandboxContainment = [ordered]@{
        passed = @($sandbox.results | Where-Object { $_.pass }).Count
        failed = @($sandbox.results | Where-Object { -not $_.pass }).Count
        failedIds = @($sandbox.results | Where-Object { -not $_.pass }).id
    }
    godotContainment = 'not-run-after-hard-failure'
    gate0c = 'not-run'
    productImplementationAuthorized = $false
    milestone1Authorized = $false
    recommendation = 'revise and repeat named probes'
}
$stageResultPath = Join-Path $reportsRoot 'gate0b-result.json'
Write-Gate0JsonAtomic -Path $stageResultPath -Value $stageResult

$scorecard = @(
    '# Gate 0 scorecard - stopped in Gate 0B',
    '',
    '**Gate 0A: PASS. Gate 0B: HARD FAILURE. Gate 0C: NOT RUN. Milestone 1 remains blocked.**',
    '',
    '## Completed evidence',
    '',
    '- Gate 0A: 9 protocol, 5 authentication, and 6 process/resource probes passed and were sealed.',
    "- Gate 0B snapshot/state: $($snapshot.results.Count) probes passed, including interruption quarantine, checksum recovery, reparse rejection, scope rejection, ambiguity, and resource ceilings.",
    '- Gate 0B static Godot capability rejection passed without starting Godot.',
    '',
    '## Hard failure',
    '',
    '- `windowsSandbox/readiness` reported `notConfigured` before setup and still reported `notConfigured` after the bounded elevated setup request.',
    '- A subsequent diagnostic `workspaceWrite` command was not contained: direct sibling write, junction traversal, spawned-child write, and loopback network connection all succeeded.',
    '- The mode label therefore provided no safety. Running Godot or a real Builder turn would have been unsafe, so both were stopped.',
    '- The harness should also be revised to refuse all sandboxed command execution when readiness is not `ready`; this diagnostic command was allowed only to measure the failure.',
    '',
    '## Safety invariants after failure',
    '',
    '- No Godot import, scenario, export, native build, Web renderer, real Builder assignment, or Gate 0C probe ran.',
    '- The synthetic current record still resolves by checksum to `v0001`; no review build or current-version promotion occurred.',
    '- The hostile effects are preserved only inside the Gate 0 evidence root.',
    '- No probe JobSupervisor/App Server process remains and no ambiguous operation was replayed.',
    '',
    '## Named repeat scope',
    '',
    '1. Repeat `B-SANDBOX-01` with immediate persistence of `windowsSandbox/setupStart` response and `windowsSandbox/setupCompleted` notification; prove final readiness is `ready`.',
    '2. Change the runner to hard-stop before `command/exec` whenever readiness is not `ready`.',
    '3. Repeat `B-SANDBOX-02` unchanged and require inside write only, unchanged sibling/junction sentinels, nonzero child escape, and zero local/public network connections.',
    '4. Only if those pass, run the previously skipped app-owned Godot import/scenario/export containment probes and reseal Gate 0B.',
    '5. Gate 0C remains prohibited until the resealed Gate 0B passes.',
    '',
    '## Recommendation',
    '',
    '**Revise and repeat named probes.**'
)
$scorecardPath = Join-Path $reportsRoot 'gate-0-scorecard.md'
[System.IO.File]::WriteAllLines($scorecardPath, $scorecard, [System.Text.UTF8Encoding]::new($false))

$sources = @(
    '# Official sources',
    '',
    "Retrieved: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'))",
    '',
    '- OpenAI Codex App Server protocol, authentication, initialization, and generated schemas: https://learn.chatgpt.com/docs/app-server',
    '- OpenAI Codex App Server CLI volatility: https://learn.chatgpt.com/docs/developer-commands#codex-app-server',
    '- OpenAI credential storage: https://learn.chatgpt.com/docs/auth#credential-storage',
    '- OpenAI Windows sandbox modes and setup: https://learn.chatgpt.com/docs/windows/windows-sandbox',
    '- OpenAI sandbox and approvals behavior: https://learn.chatgpt.com/docs/agent-approvals-security',
    '- Microsoft Job Objects: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects',
    '- Microsoft Job Object memory limits: https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information',
    '- Node detached Windows child behavior: https://nodejs.org/api/child_process.html#optionsdetached',
    '- Godot command-line execution: https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html',
    '- Godot editor tool-script risk: https://docs.godotengine.org/en/stable/tutorials/plugins/running_code_in_the_editor.html',
    '- Godot OS process APIs: https://docs.godotengine.org/en/stable/classes/class_os.html'
)
$sourcesPath = Join-Path $reportsRoot 'sources.md'
[System.IO.File]::WriteAllLines($sourcesPath, $sources, [System.Text.UTF8Encoding]::new($false))

$limitations = @(
    '# Limitations and unrun work',
    '',
    '- Gate 0 is incomplete because Gate 0B containment failed.',
    '- The elevated setup response and completion notification were not retained by the first sandbox harness. This is an evidence gap to correct in the repeat.',
    '- Sandbox mode was not inferred from labels. Actual sentinel enforcement failed and controls the decision.',
    '- Godot import, scenario, export, resource-exhaustion, and interruption probes were not run.',
    '- Native-versus-Web review-runtime comparison was not run.',
    '- No real Builder turn, playable result, review artifact, screenshot, or human play note exists.',
    '- No claims are made about fun, creative quality, gameplay acceptance, or human approval.',
    '- No Electron product UI, Producer/Designer/Reviewer orchestration, feedback loop, daemon, MCP server, database, or generic workflow engine was implemented.'
)
$limitationsPath = Join-Path $reportsRoot 'limitations.md'
[System.IO.File]::WriteAllLines($limitationsPath, $limitations, [System.Text.UTF8Encoding]::new($false))

$recommendation = @(
    '# Gate 0 recommendation',
    '',
    '**Revise and repeat named probes.**',
    '',
    'Repeat only B-SANDBOX-01 and B-SANDBOX-02 after fixing setup evidence capture and readiness fail-closed behavior. If they pass, complete the skipped Gate 0B Godot containment probes. Do not start Gate 0C or Milestone 1 before a passing resealed Gate 0B.'
)
$recommendationPath = Join-Path $reportsRoot 'gate-0-recommendation.md'
[System.IO.File]::WriteAllLines($recommendationPath, $recommendation, [System.Text.UTF8Encoding]::new($false))

$packetRoot = Join-Path $RunRoot 'sealed-failure-packet'
if (-not (Resolve-SafePath $packetRoot $RunRoot)) { throw 'Packet path escaped the run root.' }
if (Test-Path -LiteralPath $packetRoot) { Remove-Item -LiteralPath $packetRoot -Recurse -Force }
New-Item -ItemType Directory -Path $packetRoot -Force | Out-Null

function Copy-IntoPacket {
    param([string]$Source, [string]$RelativeDestination)
    $destination = Join-Path $packetRoot $RelativeDestination
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination -Recurse -Force
}

Copy-IntoPacket -Source (Join-Path $sourceRoot 'AI_Game_Studio_Critical_Technical_Response_and_Gate_0_Feasibility_Design.md') -RelativeDestination 'mvp-boundary-and-gate0-contract.md'
Copy-IntoPacket -Source (Join-Path $RunRoot 'environment.json') -RelativeDestination 'environment.json'
Copy-IntoPacket -Source (Join-Path $RunRoot 'reports\gate-0a-scorecard.md') -RelativeDestination 'gate0a/gate-0a-scorecard.md'
Copy-IntoPacket -Source (Join-Path $RunRoot 'reports\gate0a-result.json') -RelativeDestination 'gate0a/gate0a-result.json'
Copy-IntoPacket -Source (Join-Path $RunRoot 'reports\gate0a-events.jsonl') -RelativeDestination 'gate0a/gate0a-events.jsonl'
Copy-IntoPacket -Source (Join-Path $RunRoot 'reports\gate0a-evidence-manifest.json') -RelativeDestination 'gate0a/gate0a-evidence-manifest.json'
Copy-IntoPacket -Source (Join-Path $RunRoot 'protocol\codex-0.144.5\typescript') -RelativeDestination 'protocol/codex-0.144.5/typescript'
Copy-IntoPacket -Source (Join-Path $RunRoot 'protocol\codex-0.144.5\json-schema') -RelativeDestination 'protocol/codex-0.144.5/json-schema'
Get-ChildItem -LiteralPath (Join-Path $RunRoot 'protocol') -File | ForEach-Object { Copy-IntoPacket -Source $_.FullName -RelativeDestination (Join-Path 'protocol' $_.Name) }
Get-ChildItem -LiteralPath (Join-Path $RunRoot 'protocol\codex-0.144.5') -File | ForEach-Object { Copy-IntoPacket -Source $_.FullName -RelativeDestination (Join-Path 'protocol\codex-0.144.5' $_.Name) }
Get-ChildItem -LiteralPath (Join-Path $RunRoot 'auth') -File | ForEach-Object { Copy-IntoPacket -Source $_.FullName -RelativeDestination (Join-Path 'auth' $_.Name) }
Get-ChildItem -LiteralPath (Join-Path $RunRoot 'process-supervision') -File | ForEach-Object { Copy-IntoPacket -Source $_.FullName -RelativeDestination (Join-Path 'process-supervision' $_.Name) }
Copy-IntoPacket -Source (Join-Path $gate0bRoot 'snapshot-state\snapshot-and-state-report.json') -RelativeDestination 'gate0b/snapshot-state/snapshot-and-state-report.json'
Get-ChildItem -LiteralPath (Join-Path $gate0bRoot 'snapshot-state') -File | ForEach-Object { Copy-IntoPacket -Source $_.FullName -RelativeDestination (Join-Path 'gate0b\snapshot-state' $_.Name) }
Copy-IntoPacket -Source (Join-Path $gate0bRoot 'snapshot-state-attempt-1-failed.json') -RelativeDestination 'gate0b/snapshot-state-attempt-1-failed.json'
Copy-IntoPacket -Source (Join-Path $gate0bRoot 'sandbox\sandbox-report.json') -RelativeDestination 'gate0b/sandbox/sandbox-report.json'
Copy-IntoPacket -Source $hostilePath -RelativeDestination 'gate0b/sandbox/hostile-result.json'
Copy-IntoPacket -Source (Join-Path $gate0bRoot 'sandbox\outside-attempt-root') -RelativeDestination 'gate0b/sandbox/outside-attempt-root'
Copy-IntoPacket -Source $failureDetailsPath -RelativeDestination 'gate0b/gate0b-sandbox-hard-failure.json'
Copy-IntoPacket -Source $stageResultPath -RelativeDestination 'gate0b/gate0b-result.json'
Copy-IntoPacket -Source $eventSnapshot -RelativeDestination 'gate0b/gate0b-events.jsonl'
Copy-IntoPacket -Source $scorecardPath -RelativeDestination 'gate-0-scorecard.md'
Copy-IntoPacket -Source $sourcesPath -RelativeDestination 'sources.md'
Copy-IntoPacket -Source $limitationsPath -RelativeDestination 'limitations.md'
Copy-IntoPacket -Source $recommendationPath -RelativeDestination 'gate-0-recommendation.md'
Copy-IntoPacket -Source (Join-Path $gate0Root 'README.md') -RelativeDestination 'probe-source/gate0/README.md'
Copy-IntoPacket -Source (Join-Path $gate0Root 'package.json') -RelativeDestination 'probe-source/gate0/package.json'
Copy-IntoPacket -Source (Join-Path $gate0Root 'package-lock.json') -RelativeDestination 'probe-source/gate0/package-lock.json'
Copy-IntoPacket -Source (Join-Path $gate0Root 'tsconfig.json') -RelativeDestination 'probe-source/gate0/tsconfig.json'
Copy-IntoPacket -Source (Join-Path $gate0Root 'src') -RelativeDestination 'probe-source/gate0/src'
Copy-IntoPacket -Source (Join-Path $gate0Root 'scripts') -RelativeDestination 'probe-source/gate0/scripts'
Copy-IntoPacket -Source (Join-Path $gate0Root 'native') -RelativeDestination 'probe-source/gate0/native'
Copy-IntoPacket -Source (Join-Path $gate0Root 'fixtures') -RelativeDestination 'probe-source/gate0/fixtures'
Copy-IntoPacket -Source (Join-Path $gate0Root 'build\native\JobSupervisor.exe') -RelativeDestination 'probe-source/gate0/build/native/JobSupervisor.exe'

$packetEntries = @(
    Get-ChildItem -LiteralPath $packetRoot -Recurse -File |
        Sort-Object FullName |
        ForEach-Object {
            [ordered]@{
                path = $_.FullName.Substring($packetRoot.Length).TrimStart('\').Replace('\', '/')
                size = $_.Length
                sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
            }
        }
)
$packetManifestPath = Join-Path $packetRoot 'packet-manifest.json'
Write-Gate0JsonAtomic -Path $packetManifestPath -Value ([ordered]@{
    schemaVersion = 1
    status = 'Gate 0 stopped at Gate 0B hard failure'
    sealedAt = (Get-Date).ToUniversalTime().ToString('o')
    excluded = @('credential values and managed CODEX_HOME runtime files', 'large synthetic resource-limit payloads', 'unrun Gate 0B/Gate 0C evidence')
    entries = $packetEntries
})
$packetManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packetManifestPath).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $packetRoot 'packet-manifest.sha256'), "$packetManifestHash  packet-manifest.json`r`n", [System.Text.UTF8Encoding]::new($false))

Get-ChildItem -LiteralPath $packetRoot -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }

$archivePath = Join-Path $RunRoot "AI_Game_Studio_Gate0_$($current.writtenAt.Substring(0,10).Replace('-',''))_STOPPED_AT_GATE0B.zip"
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
Compress-Archive -Path (Join-Path $packetRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
$archiveIdentity = [ordered]@{
    path = $archivePath
    size = (Get-Item -LiteralPath $archivePath).Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    packetManifestSha256 = $packetManifestHash
}
$archiveIdentityPath = Join-Path $reportsRoot 'sealed-failure-packet.json'
Write-Gate0JsonAtomic -Path $archiveIdentityPath -Value $archiveIdentity

$runManifestPath = Join-Path $RunRoot 'run.json'
$runManifest = Get-Content -Raw -LiteralPath $runManifestPath | ConvertFrom-Json
$updatedRun = [ordered]@{}
foreach ($property in $runManifest.PSObject.Properties) { $updatedRun[$property.Name] = $property.Value }
$updatedRun.stage = 'Gate 0B'
$updatedRun.status = 'stopped-after-hard-failure'
$updatedRun.completedStages = @('Gate 0A')
$updatedRun.gate0bResult = 'reports/gate0b-result.json'
$updatedRun.gate0cStarted = $false
$updatedRun.milestone1Authorized = $false
$updatedRun.recommendation = 'revise and repeat named probes'
$updatedRun.sealedFailurePacket = $archiveIdentity
$updatedRun.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
Write-Gate0JsonAtomic -Path $runManifestPath -Value $updatedRun

$activePath = Join-Path (Split-Path (Split-Path $RunRoot -Parent) -Parent) 'active-run.json'
Write-Gate0JsonAtomic -Path $activePath -Value ([ordered]@{
    runId = $runManifest.runId
    stage = 'Gate 0B'
    status = 'stopped-after-hard-failure'
    evidenceRoot = $RunRoot
    completedStages = @('Gate 0A')
    gate0cStarted = $false
    milestone1Authorized = $false
    recommendation = 'revise and repeat named probes'
    updatedAt = $updatedRun.updatedAt
})

@($failureDetailsPath, $stageResultPath, $eventSnapshot, $scorecardPath, $sourcesPath, $limitationsPath, $recommendationPath, $archiveIdentityPath) | ForEach-Object {
    (Get-Item -LiteralPath $_).IsReadOnly = $true
}

$archiveIdentityPath
