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
# node.exe is deliberately untouched: on this machine those are MCP servers, not
# dev servers.

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

$targets = @(
  Get-CimInstance Win32_Process -Filter "Name='bun.exe' OR Name='bunx.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $selfChain -notcontains $_.ProcessId }
)

if ($targets.Count -eq 0) {
  Write-Host "No bun/bunx dev servers running."
} else {
  $mb = [math]::Round((($targets | Measure-Object WorkingSetSize -Sum).Sum) / 1MB)
  foreach ($t in $targets) {
    try { Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop } catch { }
  }
  Write-Host "Stopped $($targets.Count) bun/bunx process(es), freed ~$mb MB."
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
