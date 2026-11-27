# Stop Theme Pulse (your data stays - it's kept by Docker until the next start).
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot 'Runtime.ps1')
Write-Host "Stopping the app services..."
Stop-ThemeWorker 'app'
Stop-ThemeWorker 'backend'
# Also handle windows left by the previous launcher.
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
  $_.Id -ne $PID -and $_.MainWindowTitle -in @('Theme Pulse - backend (keep open)', 'Theme Pulse - app (keep open)')
} | ForEach-Object { taskkill.exe /PID $_.Id /T /F > $null 2>&1 }
Write-Host "Stopping the database (your data is kept)..."
npx --yes supabase@3.2.0 stop
# Unload only Theme Pulse's configured model; don't disturb other local AI work.
try {
  $model = 'qwen3:8b'
  Get-Content (Join-Path $PSScriptRoot 'ai.env') | ForEach-Object {
    if ($_ -match '^\s*LOCAL_LLM_MODEL\s*=\s*(\S+)') { $model = $matches[1] }
  }
  $loaded = (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3).models
  if ($loaded.name -contains $model) {
    $body = @{model=$model; keep_alive=0} | ConvertTo-Json
    Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
  }
} catch { }
Write-Host "Stopped."
Start-Sleep -Seconds 3
