# Stop every dev server this repo starts, and prove the ports came back.
#
# Windows-only, and PowerShell rather than a bun script for one reason: this has
# to outlive the thing that launched it. `bun run dev:stop` is itself a bun.exe,
# so a script that kills bun from inside bun kills its own runner mid-sentence.
#
# Two names, not one. The API runs as bun.exe; vite runs as bunx.exe
# (`bunx --bun vite`). A sweep filtered on bun.exe alone reports success and
# leaves every web server up — which is exactly how :4000 ends up with two
# listeners.
#
# MCP servers are spared, whatever runs them. node.exe is never swept, and a
# bun/bunx process is spared when its own command line or an ancestor's names an
# MCP server: `.mcp.json` starts chrome-devtools through `bunx`, and a sweep
# that took it disconnected the session's browser tools mid-run.

$ErrorActionPreference = "Stop"
$ports = 3001, 3002, 4000, 4001

# Walk up from ourselves so the `bun run dev:stop` invocation, and the shell
# above it, survive the sweep.
$selfChain = @()
$walk = $PID
while ($walk) {
  $selfChain += $walk
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$walk" -ErrorAction SilentlyContinue
  if (-not $proc) { break }
  $walk = $proc.ParentProcessId
  if ($selfChain -contains $walk) { break }
}

$byId = @{}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object { $byId[$_.ProcessId] = $_ }

function Test-UnderMcp($proc) {
  $seen = @()
  while ($proc -and $seen -notcontains $proc.ProcessId) {
    # A package name like `chrome-devtools-mcp`, not a flag: `--mcp-config` on a
    # Claude Code ancestor would otherwise spare every dev server it started.
    if ($proc.CommandLine -match "[\w.]-mcp\b|mcp-server|@modelcontextprotocol/") { return $true }
    $seen += $proc.ProcessId
    $proc = $byId[$proc.ParentProcessId]
  }
  return $false
}

$bunProcs = @(
  $byId.Values |
    Where-Object { ($_.Name -eq "bun.exe" -or $_.Name -eq "bunx.exe") -and $selfChain -notcontains $_.ProcessId }
)
$spared = @($bunProcs | Where-Object { Test-UnderMcp $_ })
$targets = @($bunProcs | Where-Object { $spared -notcontains $_ })

if ($spared.Count -gt 0) {
  Write-Host "Spared $($spared.Count) bun/bunx process(es) running an MCP server."
}

if ($targets.Count -eq 0) {
  Write-Host "No bun/bunx dev servers running."
} else {
  # Counted by what is gone afterwards, not by what was asked to stop: a process
  # Windows refuses to end stays in the list and is named below.
  foreach ($t in $targets) {
    try { Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop } catch { }
  }
  Start-Sleep -Milliseconds 300
  $survivors = @($targets | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
  $stopped = @($targets | Where-Object { $survivors -notcontains $_ })
  $mb = [math]::Round((($stopped | Measure-Object WorkingSetSize -Sum).Sum) / 1MB)
  Write-Host "Stopped $($stopped.Count) bun/bunx process(es), freed ~$mb MB."
  foreach ($s in $survivors) {
    Write-Host "  could not stop PID $($s.ProcessId): $($s.CommandLine)"
  }
}

Start-Sleep -Milliseconds 600

# The kill count is not the answer; a released port is. Windows permits two
# sockets on one port, so a survivor keeps serving requests while a freshly
# started server logs "listening" and quietly receives nothing.
$held = @()
foreach ($port in $ports) {
  $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($conns) {
    $owners = ($conns | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    $held += "  :$port still held by PID $owners"
  }
}

if ($held.Count -gt 0) {
  Write-Host ""
  Write-Host "Still listening - not a bun/bunx process, stop it by hand:"
  $held | ForEach-Object { Write-Host $_ }
  exit 1
}

Write-Host "Ports $($ports -join ', ') all clear."
