param(
    [Parameter(Mandatory = $true)][string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$sid = (Get-LocalUser -Name 'CodexSandboxOffline').SID.Value
$queries = @(
    @{ name = 'tcp-ipv4'; protocol = '6'; address = '127.0.0.1' },
    @{ name = 'udp-ipv4'; protocol = '17'; address = '127.0.0.1' },
    @{ name = 'tcp-ipv6'; protocol = '6'; address = '::1' },
    @{ name = 'udp-ipv6'; protocol = '17'; address = '::1' }
)
$results = foreach ($query in $queries) {
    $file = Join-Path $root "wfp-$($query.name).xml"
    $arguments = @(
        'wfp', 'show', 'filters',
        "file=$file",
        "protocol=$($query.protocol)",
        "remoteaddr=$($query.address)",
        "userid=$sid",
        'dir=OUT',
        'verbose=ON'
    )
    $output = & netsh.exe @arguments 2>&1 | Out-String
    [ordered]@{
        name = $query.name
        protocol = $query.protocol
        remoteAddress = $query.address
        userSid = $sid
        exitCode = $LASTEXITCODE
        console = $output.Trim()
        file = $file
        exists = Test-Path -LiteralPath $file -PathType Leaf
        size = if (Test-Path -LiteralPath $file -PathType Leaf) { (Get-Item -LiteralPath $file).Length } else { 0 }
        sha256 = if (Test-Path -LiteralPath $file -PathType Leaf) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
    }
}
$report = [ordered]@{
    schemaVersion = 1
    purpose = 'Read-only WFP active filter export for Gate 0B loopback diagnosis'
    capturedAt = [DateTime]::UtcNow.ToString('o')
    elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    mutationRequested = false
    offlineSid = $sid
    queries = $results
}
$json = $report | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $root 'wfp-elevated-export-report.json'), $json, [Text.UTF8Encoding]::new($false))
if (@($results | Where-Object { $_.exitCode -ne 0 -or -not $_.exists }).Count -ne 0) { exit 1 }
exit 0
