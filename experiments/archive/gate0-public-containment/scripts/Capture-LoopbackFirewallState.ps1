param(
    [Parameter(Mandatory = $true)][string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$offline = Get-LocalUser -Name 'CodexSandboxOffline'
$online = Get-LocalUser -Name 'CodexSandboxOnline'
$rules = Get-NetFirewallRule -PolicyStore ActiveStore | Where-Object {
    $_.Name -match 'codex' -or $_.DisplayName -match 'codex'
}

$ruleDetails = foreach ($rule in $rules) {
    $address = @($rule | Get-NetFirewallAddressFilter)
    $port = @($rule | Get-NetFirewallPortFilter)
    $application = @($rule | Get-NetFirewallApplicationFilter)
    $service = @($rule | Get-NetFirewallServiceFilter)
    $security = @($rule | Get-NetFirewallSecurityFilter)
    $interface = @($rule | Get-NetFirewallInterfaceFilter)
    [ordered]@{
        name = $rule.Name
        displayName = $rule.DisplayName
        enabled = [string]$rule.Enabled
        direction = [string]$rule.Direction
        action = [string]$rule.Action
        profile = [string]$rule.Profile
        primaryStatus = [string]$rule.PrimaryStatus
        status = [string]$rule.Status
        policyStoreSourceType = [string]$rule.PolicyStoreSourceType
        policyStoreSource = [string]$rule.PolicyStoreSource
        owner = $rule.Owner
        localAddress = @($address.LocalAddress)
        remoteAddress = @($address.RemoteAddress)
        protocol = @($port.Protocol | ForEach-Object { [string]$_ })
        localPort = @($port.LocalPort)
        remotePort = @($port.RemotePort)
        program = @($application.Program)
        package = @($application.Package)
        service = @($service.Service)
        localUser = @($security.LocalUser)
        remoteUser = @($security.RemoteUser)
        remoteMachine = @($security.RemoteMachine)
        interfaceAlias = @($interface.InterfaceAlias)
    }
}

$state = [ordered]@{
    schemaVersion = 1
    capturedAt = [DateTime]::UtcNow.ToString('o')
    computerName = $env:COMPUTERNAME
    windows = [ordered]@{
        caption = (Get-CimInstance Win32_OperatingSystem).Caption
        version = [Environment]::OSVersion.Version.ToString()
        build = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
        ubr = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').UBR
    }
    users = @(
        [ordered]@{ name = $offline.Name; sid = $offline.SID.Value; enabled = $offline.Enabled },
        [ordered]@{ name = $online.Name; sid = $online.SID.Value; enabled = $online.Enabled }
    )
    services = @(Get-Service BFE, MpsSvc | Select-Object Name, Status, StartType)
    profiles = @(Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction, AllowLocalFirewallRules)
    connectionProfiles = @(Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity, IPv6Connectivity)
    rules = @($ruleDetails)
}

$json = $state | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText((Join-Path $root 'firewall-state.json'), $json, [Text.UTF8Encoding]::new($false))

$queries = @(
    @{ name = 'tcp-ipv4'; protocol = '6'; address = '127.0.0.1' },
    @{ name = 'udp-ipv4'; protocol = '17'; address = '127.0.0.1' },
    @{ name = 'tcp-ipv6'; protocol = '6'; address = '::1' },
    @{ name = 'udp-ipv6'; protocol = '17'; address = '::1' }
)
$wfp = foreach ($query in $queries) {
    $file = Join-Path $root "wfp-$($query.name).xml"
    $arguments = @(
        'wfp', 'show', 'filters',
        "file=$file",
        "protocol=$($query.protocol)",
        "remoteaddr=$($query.address)",
        "userid=$($offline.SID.Value)",
        'dir=OUT',
        'verbose=ON'
    )
    & netsh.exe @arguments | Out-Null
    [ordered]@{
        name = $query.name
        exitCode = $LASTEXITCODE
        file = $file
        exists = Test-Path -LiteralPath $file -PathType Leaf
        size = if (Test-Path -LiteralPath $file -PathType Leaf) { (Get-Item -LiteralPath $file).Length } else { 0 }
    }
}
$wfpJson = $wfp | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $root 'wfp-query-results.json'), $wfpJson, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    outputRoot = $root
    firewallState = Join-Path $root 'firewall-state.json'
    wfpQueries = $wfp
} | ConvertTo-Json -Depth 5
