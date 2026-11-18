# Stop Theme Pulse (your data stays - it's kept by Docker until the next start).
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host "Stopping the app windows..."
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "Theme Pulse -*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Stopping the database (your data is kept)..."
npx --yes supabase@latest stop
# free the graphics card: unload the AI model from Ollama (Ollama itself keeps running, idle)
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollama) {
  try { (Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 3).models | ForEach-Object { & $ollama.Source stop $_.name 2>$null } } catch { }
}
Write-Host "Stopped."
Start-Sleep -Seconds 3
