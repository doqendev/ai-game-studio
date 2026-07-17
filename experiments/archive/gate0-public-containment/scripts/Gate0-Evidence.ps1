Set-StrictMode -Version 2

function Assert-Gate0RunRoot {
    param([Parameter(Mandatory = $true)][string]$RunRoot)

    $resolved = (Resolve-Path -LiteralPath $RunRoot).Path
    $expectedParent = (Join-Path $env:LOCALAPPDATA 'AI Game Studio\Gate0\runs')
    if (-not $resolved.StartsWith($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path is outside the Gate 0 runs root: $resolved"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resolved 'run.json'))) {
        throw "Gate 0 run manifest is missing: $resolved"
    }
    return $resolved
}

function Write-Gate0JsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $temporary = "$Path.tmp-$([Guid]::NewGuid().ToString('N'))"
    $json = $Value | ConvertTo-Json -Depth 40
    [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Add-Gate0Event {
    param(
        [Parameter(Mandatory = $true)][string]$RunRoot,
        [Parameter(Mandatory = $true)][string]$Type,
        [Parameter(Mandatory = $true)][ValidateSet('running', 'pass', 'fail', 'blocked', 'info')][string]$Status,
        [Parameter(Mandatory = $false)]$Data = @{}
    )

    $resolved = Assert-Gate0RunRoot -RunRoot $RunRoot
    $run = Get-Content -Raw -LiteralPath (Join-Path $resolved 'run.json') | ConvertFrom-Json
    $mutexName = 'Local\AI_Game_Studio_Gate0_' + ($run.runId -replace '[^A-Za-z0-9_-]', '_')
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    $acquired = $false
    try {
        $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(10))
        if (-not $acquired) { throw 'Timed out waiting for the Gate 0 evidence mutex.' }

        $eventsPath = Join-Path $resolved 'events.jsonl'
        $sequence = if (Test-Path -LiteralPath $eventsPath) {
            ([System.IO.File]::ReadLines($eventsPath) | Measure-Object).Count + 1
        } else {
            1
        }
        $event = [ordered]@{
            seq = $sequence
            at = (Get-Date).ToUniversalTime().ToString('o')
            stage = $run.stage
            type = $Type
            status = $Status
            data = $Data
        }
        $line = ($event | ConvertTo-Json -Depth 40 -Compress) + [Environment]::NewLine
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($line)
        $stream = New-Object System.IO.FileStream(
            $eventsPath,
            [System.IO.FileMode]::Append,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::Read,
            4096,
            [System.IO.FileOptions]::WriteThrough)
        try {
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally {
            $stream.Dispose()
        }
    } finally {
        if ($acquired) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Get-Gate0FileIdentity {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        path = $item.FullName
        size = $item.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
        productVersion = $item.VersionInfo.ProductVersion
        fileVersion = $item.VersionInfo.FileVersion
    }
}

