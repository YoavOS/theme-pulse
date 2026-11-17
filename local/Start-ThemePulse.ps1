# Theme Pulse on your own PC - start everything and open the app.
# Run it by double-clicking "Start Theme Pulse.bat" in the main folder.
# Safe to run again any time: it only starts what isn't running yet.

$ErrorActionPreference = "Continue"   # outside tools print notes to stderr; exit codes decide
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$LogDir = Join-Path $Root "local\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir ("start-" + (Get-Date -Format "yyyy-MM-dd_HH-mm") + ".log")
Start-Transcript -Path $Log -Append | Out-Null

function Say($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host ""; Write-Host "PROBLEM: $msg" -ForegroundColor Red
  Write-Host "The details are saved in $Log" -ForegroundColor Yellow
  Stop-Transcript | Out-Null
  Read-Host "Press Enter to close"
  exit 1
}
function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# -- 1. Unpack the app the first time --------------------------------------------------------
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $tarball = Join-Path $Root "local\app-source.tar.gz"
  if (-not (Test-Path $tarball)) { Fail "The app files are missing (local\app-source.tar.gz)." }
  Say "Unpacking the app files (first run only)"
  tar -xzf $tarball -C $Root
  if ($LASTEXITCODE -ne 0) { Fail "Couldn't unpack the app files." }
}

# -- 2. Node.js -----------------------------------------------------------------------------
Refresh-Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Say "Installing Node.js (one time). Windows may ask for permission."
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js didn't install. Install the LTS version from https://nodejs.org and run this again." }
}
Write-Host ("Node " + (node --version))

# -- 3. Docker Desktop ----------------------------------------------------------------------
Say "Checking Docker Desktop"
$dockerOk = $false
$dockerOk = $false
if (Get-Command docker -ErrorAction SilentlyContinue) { docker info > $null 2>&1; $dockerOk = ($LASTEXITCODE -eq 0) }
if (-not $dockerOk) {
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $exe)) { Fail "Docker Desktop isn't installed (or is in an unusual place). Install it from https://www.docker.com/products/docker-desktop and run this again." }
  Write-Host "Starting Docker Desktop and waiting for it (up to 3 minutes)..."
  Start-Process $exe
  for ($i = 0; $i -lt 36; $i++) {
    Start-Sleep -Seconds 5
    Refresh-Path
    if (Get-Command docker -ErrorAction SilentlyContinue) { docker info > $null 2>&1; if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break } }
  }
  if (-not $dockerOk) { Fail "Docker Desktop didn't finish starting. Open it, wait until it says 'Engine running', then run this again." }
}
Write-Host "Docker is running."

# -- 4. Your API keys -----------------------------------------------------------------------
$Keys = Join-Path $Root "local\keys.env"
if (-not (Test-Path $Keys)) {
  Copy-Item (Join-Path $Root "local\keys.example.env") $Keys
  Say "Paste your API keys into the file that opens, save it (Ctrl+S) and close Notepad."
  Start-Process notepad.exe $Keys -Wait
}
$missing = @()
foreach ($k in @("FINNHUB_API_KEY", "FMP_API_KEY")) {
  $line = Select-String -Path $Keys -Pattern ("^\s*" + $k + "\s*=\s*\S+") -Quiet
  if (-not $line) { $missing += $k }
}
if ($missing.Count -gt 0) {
  Start-Process notepad.exe $Keys -Wait
  $missing = @()
  foreach ($k in @("FINNHUB_API_KEY", "FMP_API_KEY")) {
    if (-not (Select-String -Path $Keys -Pattern ("^\s*" + $k + "\s*=\s*\S+") -Quiet)) { $missing += $k }
  }
  if ($missing.Count -gt 0) { Fail ("These keys are still empty in local\keys.env: " + ($missing -join ", ")) }
}
Copy-Item $Keys (Join-Path $Root "supabase\functions\.env") -Force

# -- 5. App packages ------------------------------------------------------------------------
$stamp = Join-Path $Root "node_modules\.installed-from"
$lockHash = (Get-FileHash (Join-Path $Root "package.json")).Hash
if (-not (Test-Path $stamp) -or (Get-Content $stamp -ErrorAction SilentlyContinue) -ne $lockHash) {
  Say "Installing the app's packages (first run takes a few minutes)"
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
  Set-Content -Path $stamp -Value $lockHash
}

# -- 6. Database and backend ----------------------------------------------------------------
Say "Starting the database and backend (the first time downloads about 2 GB - be patient)"
npx --yes supabase@latest start
if ($LASTEXITCODE -ne 0) { Fail "The database didn't start (see the messages above)." }

$status = npx --yes supabase@latest status -o env 2> $null
$vals = @{}
foreach ($line in $status) { if ($line -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') { $vals[$matches[1]] = $matches[2] } }
$apiUrl = $vals["API_URL"]
$anon = $vals["ANON_KEY"]; if (-not $anon) { $anon = $vals["PUBLISHABLE_KEY"] }
if (-not $apiUrl -or -not $anon) { Fail "Couldn't read the local database address and key." }

# the website talks to the local backend
@(
  "VITE_SUPABASE_URL=$apiUrl",
  "VITE_SUPABASE_PUBLISHABLE_KEY=$anon",
  "VITE_SUPABASE_PROJECT_ID=local"
) | Set-Content -Path (Join-Path $Root ".env.local") -Encoding ascii

# scheduled jobs point at the local backend
$db = (docker ps --format "{{.Names}}" | Where-Object { $_ -like "supabase_db_*" } | Select-Object -First 1)
$kong = (docker ps --format "{{.Names}}" | Where-Object { $_ -like "supabase_kong_*" } | Select-Object -First 1)
if (-not $db -or -not $kong) { Fail "Couldn't find the database containers in Docker." }
Say "Setting up the scheduled jobs"
Get-Content (Join-Path $Root "local\setup-local.sql") -Raw | docker exec -i $db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { Fail "Setting up the scheduled jobs failed." }
$settings = "INSERT INTO public.local_settings(key, value) VALUES ('functions_url', 'http://${kong}:8000/functions/v1'), ('anon_key', '$anon') ON CONFLICT (key) DO UPDATE SET value = excluded.value;"
$settings | docker exec -i $db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { Fail "Saving the job settings failed." }

# -- 7. Daily backup of your data (kept for 14 days) ----------------------------------------
$BackupDir = Join-Path $Root "local\backups"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$today = Join-Path $BackupDir ("data-" + (Get-Date -Format "yyyy-MM-dd") + ".sql")
if (-not (Test-Path $today)) {
  Say "Backing up today's data"
  npx --yes supabase@latest db dump --local --data-only -f $today
  if ($LASTEXITCODE -ne 0) { Write-Host "Backup didn't work this time - the app still runs." -ForegroundColor Yellow }
  Get-ChildItem $BackupDir -Filter "data-*.sql" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
}

# -- 8. Backend functions and the website, each in its own window --------------------------
Say "Starting the backend functions"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Theme Pulse - backend (keep open)'; Set-Location '$Root'; npx --yes supabase@latest functions serve --env-file supabase\functions\.env" -WindowStyle Minimized

Say "Starting the app"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.ui.RawUI.WindowTitle = 'Theme Pulse - app (keep open)'; Set-Location '$Root'; npm run dev -- --port 8080 --strictPort" -WindowStyle Minimized
Start-Sleep -Seconds 8
Start-Process "http://localhost:8080"

Say "Theme Pulse is running at http://localhost:8080"
Write-Host "Keep the two minimized 'Theme Pulse' windows open while you use the app."
Write-Host "Missed nightly jobs catch up by themselves within about an hour."
Stop-Transcript | Out-Null
Start-Sleep -Seconds 6
