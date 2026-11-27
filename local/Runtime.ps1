# Track only processes started by this copy of Theme Pulse (PID + creation time).
$RuntimeDir = Join-Path $PSScriptRoot 'run'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
function Get-ThemeWorker($kind) {
  try {
    $state = Get-Content (Join-Path $RuntimeDir "$kind.json") -Raw -ErrorAction Stop | ConvertFrom-Json
    $p = Get-Process -Id $state.id -ErrorAction Stop
    if ($p.StartTime.ToUniversalTime().Ticks.ToString() -eq $state.started) { return $p }
  } catch { }
  return $null
}
function Test-ThemeWorker($kind) { return $null -ne (Get-ThemeWorker $kind) }
function Test-ThemeWebsite {
  try {
    return (Invoke-WebRequest 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
  } catch { return $false }
}
function Test-ThemeBackend {
  # Worker PIDs alone are insufficient: Docker may have been quit independently.
  $states = @(docker inspect --format '{{.State.Running}}' supabase_db_hhdvcqidyntxvwhyygxx supabase_edge_runtime_hhdvcqidyntxvwhyygxx 2>$null)
  return $LASTEXITCODE -eq 0 -and $states.Count -eq 2 -and @($states | Where-Object { $_ -ne 'true' }).Count -eq 0
}
function Start-ThemeWorker($kind) {
  if (Test-ThemeWorker $kind) { return }
  $script = Join-Path $PSScriptRoot 'Worker.ps1'
  $p = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$script`"",'-Kind',$kind) -WindowStyle Hidden -PassThru
  @{ id=$p.Id; started=$p.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content (Join-Path $RuntimeDir "$kind.json")
}
function Stop-ThemeWorker($kind) {
  $p = Get-ThemeWorker $kind
  if ($p) { taskkill.exe /PID $p.Id /T /F > $null 2>&1 }
  Remove-Item -LiteralPath (Join-Path $RuntimeDir "$kind.json") -ErrorAction SilentlyContinue
}
