param(
    [Parameter(Mandatory = $true)][string]$SetupRoot,
    [Parameter(Mandatory = $true)][string]$PriorRunRoot
)

$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $SetupRoot).Path
$prior = (Resolve-Path -LiteralPath $PriorRunRoot).Path
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$packet = Join-Path $setup "sealed-loopback-failure-$stamp"
$archive = Join-Path $setup "AI_Game_Studio_Gate0B_LOOPBACK_FAILURE_$stamp.zip"
New-Item -ItemType Directory -Path $packet | Out-Null

function Copy-EvidenceFile {
    param([string]$Source, [string]$Relative)
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
    $destination = Join-Path $packet $Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination
}

function Copy-EvidenceTree {
    param([string]$SourceRoot, [string]$RelativeRoot)
    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) { return }
    $resolved = (Resolve-Path -LiteralPath $SourceRoot).Path
    Get-ChildItem -LiteralPath $resolved -Recurse -File | Sort-Object FullName | ForEach-Object {
        if (-not $_.FullName.StartsWith("$resolved\", [StringComparison]::OrdinalIgnoreCase)) {
            throw "Evidence path escaped source root: $($_.FullName)"
        }
        $relative = $_.FullName.Substring($resolved.Length + 1)
        Copy-EvidenceFile $_.FullName (Join-Path $RelativeRoot $relative)
    }
}

$setupReportPath = Join-Path $setup 'windows-sandbox-setup-report.json'
$setupReport = Get-Content -LiteralPath $setupReportPath -Raw | ConvertFrom-Json
$matrixDirectory = Get-ChildItem -LiteralPath (Join-Path $setup 'diagnostics') -Directory |
    Where-Object { $_.Name -match 'loopback-matrix$' } |
    Sort-Object Name -Descending |
    Select-Object -First 1
if (-not $matrixDirectory) { throw 'Loopback matrix evidence is missing.' }
$matrixReportPath = Join-Path $matrixDirectory.FullName 'loopback-network-matrix-report.json'
$matrix = Get-Content -LiteralPath $matrixReportPath -Raw | ConvertFrom-Json
$identityDirectory = Get-ChildItem -LiteralPath (Join-Path $setup 'diagnostics') -Directory |
    Where-Object { $_.Name -match 'sandbox-identity$' } |
    Sort-Object Name -Descending |
    Select-Object -First 1
$identity = Get-Content -LiteralPath (Join-Path $identityDirectory.FullName 'sandbox-identity-diagnostic-report.json') -Raw | ConvertFrom-Json
$firewallDirectory = Get-ChildItem -LiteralPath (Join-Path $setup 'diagnostics') -Directory |
    Where-Object { $_.Name -match 'firewall-state$' } |
    Sort-Object Name -Descending |
    Select-Object -First 1
$firewall = Get-Content -LiteralPath (Join-Path $firewallDirectory.FullName 'firewall-state.json') -Raw | ConvertFrom-Json

$assertionValues = @($matrix.assertions.psobject.Properties | ForEach-Object { $_.Value.blocked })
$conclusion = [ordered]@{
    schemaVersion = 1
    stage = 'Gate 0B'
    status = 'hard-failure'
    decision = 'stop-before-godot-and-gate0c'
    completedAt = [DateTime]::UtcNow.ToString('o')
    setup = [ordered]@{
        pass = $setupReport.pass
        initialStatus = $setupReport.initialReadiness.status
        completionSuccess = $setupReport.completionNotification.payload.params.success
        completionMode = $setupReport.completionNotification.payload.params.mode
        finalStatus = $setupReport.finalReadiness.status
        restartWithSameManagedHome = 'ready'
        freshManagedHome = 'updateRequired'
    }
    effectiveSandboxIdentity = [ordered]@{
        username = $identity.identity.osUserInfo.username
        sidCsv = $identity.identity.user.stdout
        expectedOfflineSid = ($firewall.users | Where-Object { $_.name -eq 'CodexSandboxOffline' }).sid
        identityMatchesFirewallRule = $identity.identity.user.stdout -match [regex]::Escape(($firewall.users | Where-Object { $_.name -eq 'CodexSandboxOffline' }).sid)
    }
    firewall = [ordered]@{
        codexLoopbackTcpRuleActive = @($firewall.rules | Where-Object { $_.displayName -eq 'codex_sandbox_offline_block_loopback_tcp' -and $_.primaryStatus -eq 'OK' }).Count -eq 1
        codexLoopbackUdpRuleActive = @($firewall.rules | Where-Object { $_.displayName -eq 'codex_sandbox_offline_block_loopback_udp' -and $_.primaryStatus -eq 'OK' }).Count -eq 1
        proxyPorts = @()
        allowLocalBinding = $false
        elevatedWfpExport = 'not obtained; helper invocation/export failed before producing XML'
        correctionApplied = $false
        correctionDecision = 'No ordinary-firewall change was evidence-backed. A custom privileged WFP component would materially broaden the architecture.'
    }
    loopbackMatrix = [ordered]@{
        commandExecutionCount = $matrix.commandExecutionCount
        automaticReplayCount = $matrix.automaticReplayCount
        tcpIpv4Blocked = $matrix.assertions.'tcp-ipv4'.blocked
        tcpIpv6Blocked = $matrix.assertions.'tcp-ipv6'.blocked
        udpIpv4Blocked = $matrix.assertions.'udp-ipv4'.blocked
        udpIpv6Blocked = $matrix.assertions.'udp-ipv6'.blocked
        allBlocked = -not ($assertionValues -contains $false)
        processStopCode = $matrix.processStop.code
    }
    safety = [ordered]@{
        currentVersionChanged = $false
        reviewBuildCreated = $false
        godotStarted = $false
        gate0cStarted = $false
        productImplementationStarted = $false
        automaticReplayCount = 0
    }
    recommendation = 'stop or materially change the product direction'
    requiredDirectionChange = 'Replace the native Codex Windows sandbox as the Builder trust boundary with a proven VM-class boundary, then define and authorize a new Gate 0. Do not add a custom privileged WFP service or weaken the zero-network requirement by default.'
}

$reportsRoot = Join-Path $packet 'reports'
New-Item -ItemType Directory -Path $reportsRoot -Force | Out-Null
$conclusionJson = $conclusion | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText((Join-Path $reportsRoot 'gate0b-loopback-conclusion.json'), $conclusionJson, [Text.UTF8Encoding]::new($false))
$conclusionMarkdown = @"
# Gate 0B loopback conclusion

Gate 0B remains a hard failure. The elevated Codex Windows sandbox reported ready and ran as the intended CodexSandboxOffline SID, while active Codex rules targeted IPv4 and IPv6 loopback with no proxy exception. One bounded app-owned matrix nevertheless reached all four sentinels: TCP/IPv4, TCP/IPv6, UDP/IPv4, and UDP/IPv6.

No firewall correction was applied. Duplicating the existing rule is unsupported by evidence; a custom privileged WFP component would materially broaden the architecture and recreate the security infrastructure Gate 0 was intended to avoid.

Godot containment, Gate 0C, product implementation, and Milestone 1 remain blocked.

**Recommendation: stop or materially change the product direction.** Replace the native Codex Windows sandbox as the Builder trust boundary with a proven VM-class boundary and authorize a new Gate 0 before continuing.
"@
[IO.File]::WriteAllText((Join-Path $reportsRoot 'gate0b-loopback-conclusion.md'), $conclusionMarkdown, [Text.UTF8Encoding]::new($false))
$sources = @"
# Official sources

- OpenAI Windows sandbox: https://learn.chatgpt.com/docs/windows/windows-sandbox
- OpenAI Codex firewall implementation: https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/firewall.rs
- Microsoft WFP filtering condition flags: https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-condition-flags-
- Microsoft Application Layer Enforcement: https://learn.microsoft.com/en-us/windows/win32/fwp/application-layer-enforcement--ale-
- Microsoft New-NetFirewallRule: https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule
"@
[IO.File]::WriteAllText((Join-Path $reportsRoot 'sources.md'), $sources, [Text.UTF8Encoding]::new($false))

Copy-EvidenceFile $setupReportPath 'setup/windows-sandbox-setup-report.json'
Copy-EvidenceFile (Join-Path $setup 'codex-home/config.toml') 'setup/codex-home-config.toml'
Copy-EvidenceFile (Join-Path $setup 'codex-home/.sandbox/setup_marker.json') 'setup/setup_marker.json'
Copy-EvidenceFile (Join-Path $setup 'codex-home/.sandbox/sandbox.2026-07-16.log') 'setup/sandbox.2026-07-16.log'
Copy-EvidenceFile (Join-Path $prior 'environment.json') 'prior/environment.json'
Copy-EvidenceTree (Join-Path $setup 'diagnostics') 'diagnostics'

Get-ChildItem -LiteralPath $setup -Directory | Where-Object { $_.Name -match '(restart-readiness|containment-repeat)$' } | ForEach-Object {
    $directory = $_
    @('restart-readiness-report.json','sandbox-containment-repeat-report.json','attempt-root/hostile-result.json','attempt-root/allowed-write.txt','outside-attempt-root/sentinel.txt') | ForEach-Object {
        Copy-EvidenceFile (Join-Path $directory.FullName $_) (Join-Path "attempts/$($directory.Name)" $_)
    }
}

$preArchive = Get-ChildItem -LiteralPath $setup -File -Filter 'Gate0B_Loopback_PreRemediation_*.zip' | Sort-Object Name -Descending | Select-Object -First 1
if ($preArchive) {
    Copy-EvidenceFile $preArchive.FullName "pre-remediation/$($preArchive.Name)"
    Copy-EvidenceFile "$($preArchive.FullName).sha256" "pre-remediation/$($preArchive.Name).sha256"
}

$repo = Split-Path -Parent $PSScriptRoot
@(
    'src/app-server-client.ts',
    'src/run-windows-sandbox-setup.ts',
    'src/query-windows-sandbox-readiness.ts',
    'src/run-sandbox-containment-repeat.ts',
    'src/run-sandbox-identity-diagnostic.ts',
    'src/run-loopback-network-matrix.ts',
    'fixtures/hostile-sandbox-probe.mjs',
    'fixtures/sandbox-identity-probe.mjs',
    'fixtures/loopback-network-probe.mjs',
    'scripts/Capture-LoopbackFirewallState.ps1',
    'scripts/Capture-WfpElevated.ps1',
    'scripts/Seal-Gate0BLoopbackEvidence.ps1',
    'scripts/Finalize-Gate0BLoopbackFailure.ps1'
) | ForEach-Object { Copy-EvidenceFile (Join-Path $repo $_) (Join-Path 'probe-source' $_) }

$entries = New-Object System.Collections.Generic.List[object]
Get-ChildItem -LiteralPath $packet -Recurse -File | Sort-Object FullName | ForEach-Object {
    if (-not $_.FullName.StartsWith("$packet\", [StringComparison]::OrdinalIgnoreCase)) { throw "Packet escape: $($_.FullName)" }
    $relative = $_.FullName.Substring($packet.Length + 1).Replace('\', '/')
    $entries.Add([ordered]@{ path = $relative; size = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() })
}
$manifest = [ordered]@{
    schemaVersion = 1
    purpose = 'Terminal Gate 0B loopback containment failure evidence'
    createdAt = [DateTime]::UtcNow.ToString('o')
    priorSealedGate0ArchiveSha256 = '5c162e6afe33684e0469bd1a0e36058820bfaeac8d5b408826e68027cf206f90'
    entries = $entries
}
$manifestPath = Join-Path $packet 'packet-manifest.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
$manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $packet 'packet-manifest.sha256'), "$manifestHash  packet-manifest.json`r`n", [Text.Encoding]::ASCII)
Compress-Archive -Path (Join-Path $packet '*') -DestinationPath $archive -CompressionLevel Optimal
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$archive.sha256", "$archiveHash  $([IO.Path]::GetFileName($archive))`r`n", [Text.Encoding]::ASCII)

[pscustomobject]@{
    packet = $packet
    archive = $archive
    archiveSha256 = $archiveHash
    manifestSha256 = $manifestHash
    evidenceEntryCount = $entries.Count
    archiveSize = (Get-Item -LiteralPath $archive).Length
    conclusion = Join-Path $reportsRoot 'gate0b-loopback-conclusion.md'
} | ConvertTo-Json -Depth 4
