# Stop Theme Pulse (your data stays - it's kept by Docker until the next start).
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host "Stopping the app windows..."
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "Theme Pulse -*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Stopping the database (your data is kept)..."
npx --yes supabase@latest stop
Write-Host "Stopped."
Start-Sleep -Seconds 3
