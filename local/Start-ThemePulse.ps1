# Theme Pulse on your own PC - start everything and open the app.
# Run it by double-clicking "Start Theme Pulse.bat" in the main folder.
# Safe to run again any time: it only starts what isn't running yet.

$ErrorActionPreference = "Continue"   # outside tools print notes to stderr; exit codes decide
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot 'Runtime.ps1')
$launchLock = New-Object System.Threading.Mutex($false, 'Local\ThemePulseStartup')
$ownsLock = $false
try { $ownsLock = $launchLock.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $ownsLock = $true }
if (-not $ownsLock) { Write-Host 'Theme Pulse is already starting. Check its startup window.'; Start-Sleep -Seconds 3; exit 0 }
try {
$LogDir = Join-Path $Root "local\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir ("start-" + (Get-Date -Format "yyyy-MM-dd_HH-mm-ss") + ".log")
Start-Transcript -Path $Log -Append | Out-Null
Write-Host 'Checking Theme Pulse. The browser opens when the app is ready.' -ForegroundColor Cyan
if ((Test-ThemeWorker 'backend') -and (Test-ThemeWorker 'app') -and (Test-ThemeBackend) -and (Test-ThemeWebsite)) {
  Start-Process 'http://localhost:8080'
  Write-Host 'Reusing the running app. Use Stop before applying updates.'
  Stop-Transcript | Out-Null
  exit 0
}
if ((Test-ThemeWorker 'backend') -and -not (Test-ThemeBackend)) {
  Write-Host 'Recovering the stopped backend...'
  Stop-ThemeWorker 'backend'
}
if ((Test-ThemeWorker 'app') -and -not (Test-ThemeWebsite)) { Stop-ThemeWorker 'app' }
Write-Host 'Starting missing services. A cold Docker start can take a few minutes.'

function Say($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host ""; Write-Host "PROBLEM: $msg" -ForegroundColor Red
  Write-Host "The details are saved in $Log" -ForegroundColor Yellow
  Stop-Transcript | Out-Null
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
  Start-Process $exe -WindowStyle Hidden
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

# -- 4b. The AI on your PC (Ollama) ---------------------------------------------------------
# Settings live in local\ai.env (which model, or LOCAL_AI=off). Without it the app falls back
# to the free cloud keys (Gemini / Groq) in keys.env.
$AiEnv = Join-Path $Root "local\ai.env"
if (-not (Test-Path $AiEnv)) { Copy-Item (Join-Path $Root "local\ai.example.env") $AiEnv }
$light = $true
$aiModel = "qwen3:8b"; $aiOn = $true; $aiCtx = "16384"; $backgroundAi = "off"
foreach ($line in (Get-Content $AiEnv)) {
  if ($line -match '^\s*LOCAL_LLM_MODEL\s*=\s*(\S+)') { $aiModel = $matches[1] }
  if ($line -match '^\s*LOCAL_LLM_CTX\s*=\s*(\d+)') { $aiCtx = $matches[1] }
  if ($line -match '^\s*LIGHT\s*=\s*off') { $light = $false }
  if ($line -match '^\s*BACKGROUND_AI\s*=\s*on') { $backgroundAi = 'on' }
  if ($line -match '^\s*LOCAL_AI\s*=\s*off') { $aiOn = $false }
}
function Test-Ollama { try { Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 } catch { $null } }
function Find-Ollama {
  $c = Get-Command ollama -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $p) { return $p }
  return $null
}
$aiReady = $false
if ($aiOn) {
  Say "Checking the AI on your PC (Ollama, model $aiModel)"
  $ollamaExe = Find-Ollama
  if (-not $ollamaExe) {
    $ans = Read-Host "Ollama (runs the AI on your PC, free) isn't installed. Install it now? (Y/n)"
    if ($ans -notmatch '^[nN]') {
      winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
      Refresh-Path
      $ollamaExe = Find-Ollama
    }
  }
  if ($ollamaExe) {
    $tags = Test-Ollama
    if (-not $tags) {
      Write-Host "Starting Ollama..."
      $env:OLLAMA_FLASH_ATTENTION = "1"; $env:OLLAMA_KV_CACHE_TYPE = "q8_0"; $env:OLLAMA_KEEP_ALIVE = "60s"; $env:OLLAMA_MAX_LOADED_MODELS = "1"; $env:OLLAMA_NUM_PARALLEL = "1"
      Start-Process $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
      for ($i = 0; $i -lt 15 -and -not $tags; $i++) { Start-Sleep -Seconds 2; $tags = Test-Ollama }
    }
    if ($tags) {
      $names = @($tags.models | ForEach-Object { $_.name })
      Write-Host ("Models on this PC: " + ($(if ($names.Count) { $names -join ", " } else { "none yet" })))
      $want = if ($aiModel -match ':') { $aiModel } else { "${aiModel}:latest" }
      if ($names -notcontains $want) {
        $ans = Read-Host "Download the AI model $aiModel now? The default 8B model is about 5.2 GB, once. (Y/n)"
        if ($ans -notmatch '^[nN]') {
          & $ollamaExe pull $aiModel
          $tags = Test-Ollama; $names = @($tags.models | ForEach-Object { $_.name })
        }
      }
      if ($names -contains $want) { $aiReady = $true; Write-Host "The AI is ready: $aiModel" }
      else { Write-Host "The model isn't downloaded - the app uses the cloud keys for AI until it is." -ForegroundColor Yellow }
    } else { Write-Host "Ollama didn't answer - the app uses the cloud keys for AI this time." -ForegroundColor Yellow }
  } else { Write-Host "No Ollama - the app uses the cloud keys for AI." -ForegroundColor Yellow }
}
# Bound context memory in light mode. Larger inputs need a deliberate configuration change.
if ($light -and [int]$aiCtx -gt 16384) { $aiCtx = "16384" }
if ($aiReady) {
  Add-Content -Path (Join-Path $Root "supabase\functions\.env") -Value @("", "LOCAL_LLM_URL=http://host.docker.internal:11434", "LOCAL_LLM_MODEL=$aiModel", "LOCAL_LLM_CTX=$aiCtx", "LOCAL_LLM_KEEP_ALIVE=60s", "LOCAL_LLM_THREADS=4")
}

Add-Content -Path (Join-Path $Root "supabase\functions\.env") -Value @("", "DAILY_BARS_CONCURRENCY=1", "DAILY_BARS_BUDGET_MS=20000")

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
# Light start: skip the parts of the local stack the app doesn't use (log pipeline, file storage, image
# resizing, realtime, the test mailbox, the connection pooler, and the Studio admin site).
# For Studio, add STUDIO=on to local\ai.env.
$skip = "vector,logflare,imgproxy,mailpit,realtime,storage-api,supavisor"
if (-not (Select-String -Path (Join-Path $Root "local\ai.env") -Pattern '^\s*STUDIO\s*=\s*on' -Quiet -ErrorAction SilentlyContinue)) { $skip += ",studio,postgres-meta" }
$project = 'hhdvcqidyntxvwhyygxx'
$unused = @('vector','analytics','imgproxy','inbucket','mailpit','realtime','storage','supavisor')
if ($skip -match 'studio') { $unused += @('studio','pg_meta') }
$existing = @(docker ps -a --format '{{.Names}}')
foreach ($service in $unused) {
  $name = "supabase_${service}_${project}"
  if ($existing -contains $name) {
    docker update --restart=no $name > $null 2>&1
    docker stop $name > $null 2>&1
  }
}
$startOutput = npx --yes supabase@3.2.0 start -x $skip 2>&1
if ($LASTEXITCODE -ne 0) {
  $startOutput | Where-Object { $_ -notmatch '(?i)key|secret|jwt|postgresql://' } | Write-Host
  Fail "The database did not start."
}
# app updates may bring new database changes: apply any that this database hasn't had yet
npx --yes supabase@3.2.0 migration up --local
if ($LASTEXITCODE -ne 0) { Write-Host "Some database updates didn't apply - see the messages above." -ForegroundColor Yellow }

$status = npx --yes supabase@3.2.0 status -o env 2> $null
$vals = @{}
foreach ($line in $status) { if ($line -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') { $vals[$matches[1]] = $matches[2] } }
$apiUrl = $vals["API_URL"]
$anon = $vals["ANON_KEY"]; if (-not $anon) { $anon = $vals["PUBLISHABLE_KEY"] }
if (-not $apiUrl -or -not $anon) { Fail "Couldn't read the local database address and key." }

# the website talks to the local backend
@(
  "VITE_SUPABASE_URL=$apiUrl",
  "VITE_SUPABASE_PUBLISHABLE_KEY=$anon",
  "VITE_SUPABASE_PROJECT_ID=local",
  "VITE_LIGHT_MODE=true"
) | Set-Content -Path (Join-Path $Root ".env.local") -Encoding ascii

# scheduled jobs point at the local backend
$running = @(docker ps --format "{{.Names}}")
$db = "supabase_db_$project"; $kong = "supabase_kong_$project"
if ($running -notcontains $db -or $running -notcontains $kong) { Fail "The Theme Pulse containers are not running." }
if (-not $db -or -not $kong) { Fail "Couldn't find the database containers in Docker." }
# Cap only this project's heavy services, leaving other Docker projects alone.
docker update --cpus=1.5 $db > $null
if ($LASTEXITCODE -ne 0) { Fail 'Could not apply the database CPU limit.' }
Say "Setting up the scheduled jobs"
Get-Content (Join-Path $Root "local\setup-local.sql") -Raw | docker exec -i $db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { Fail "Setting up the scheduled jobs failed." }
$settings = "INSERT INTO public.local_settings(key, value) VALUES ('functions_url', 'http://${kong}:8000/functions/v1'), ('anon_key', '$anon') ON CONFLICT (key) DO UPDATE SET value = excluded.value;"
$settings | docker exec -i $db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { Fail "Saving the job settings failed." }
# A ten-minute quiet startup; scheduled AI is opt-in, manual AI still works.
"INSERT INTO public.local_settings(key,value) VALUES ('background_ai','$backgroundAi'), ('background_not_before',(now() + interval '10 minutes')::text) ON CONFLICT(key) DO UPDATE SET value=excluded.value;" | docker exec -i $db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { Fail 'Could not save the startup quiet period.' }
# long AI jobs go from the database straight to the AI on this PC (no time limit per request)
if ($aiReady) { $aiSql = "INSERT INTO public.local_settings(key, value) VALUES ('ollama_url', 'http://host.docker.internal:11434') ON CONFLICT (key) DO UPDATE SET value = excluded.value;" }
else { $aiSql = "DELETE FROM public.local_settings WHERE key = 'ollama_url';" }
$aiSql | docker exec -i $db psql -U postgres -d postgres -q

# -- 7. Daily backup of your data (kept for 14 days) ----------------------------------------
$BackupDir = Join-Path $Root "local\backups"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$today = Join-Path $BackupDir ("data-" + (Get-Date -Format "yyyy-MM-dd") + ".sql")
if (-not (Test-Path $today)) {
  Say "Backing up today's data"
  npx --yes supabase@3.2.0 db dump --local --data-only -f $today
  if ($LASTEXITCODE -ne 0) { Write-Host "Backup didn't work this time - the app still runs." -ForegroundColor Yellow }
  Get-ChildItem $BackupDir -Filter "data-*.sql" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
}

# -- 8. Backend functions and the website, each in its own window --------------------------
Say "Starting the backend functions"
Start-ThemeWorker 'backend'


Say "Starting the app"
# A built copy of the website is much lighter than the development server. It is rebuilt only when the code changed.
$srcStamp = ((Get-ChildItem (Join-Path $Root "src") -Recurse -File | Measure-Object -Property LastWriteTime -Maximum).Maximum).Ticks
$srcStamp = "$srcStamp-" + (Get-FileHash (Join-Path $Root ".env.local")).Hash   # the backend address is baked into the build
$builtFile = Join-Path $Root "dist\.built-from"
if (-not (Test-Path $builtFile) -or (Get-Content $builtFile -ErrorAction SilentlyContinue) -ne "$srcStamp") {
  Say "Building the website (only after updates; about a minute)"
  npx vite build
  if ($LASTEXITCODE -eq 0) { Set-Content -Path $builtFile -Value "$srcStamp" } else { Fail "Build failed. The old build was not started; see the errors above." }
}
if (-not (Test-Path $builtFile)) { Fail 'No production build is available. See the build log.' }
Start-ThemeWorker 'app'
Say 'Waiting for the website and backend to be ready (up to 90 seconds)'
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
  $edge = "supabase_edge_runtime_$project"
  if ((Test-ThemeBackend) -and (Test-ThemeWebsite)) {
    docker update --cpus=2 $edge > $null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not apply the backend CPU limit.' }
    $ready = $true
    break
  }
  if (-not (Test-ThemeWorker 'backend') -or -not (Test-ThemeWorker 'app')) { Fail 'An app service exited. See the newest app/backend log in local\logs.' }
  Start-Sleep -Seconds 2
}
if (-not $ready) { Fail 'The app did not become ready. See the newest app/backend log in local\logs.' }
Start-Process "http://localhost:8080"

Say "Theme Pulse is running at http://localhost:8080"
Write-Host "The app services run quietly in the background. Use Stop Theme Pulse to shut them down."
Write-Host "Background data updates begin after 10 minutes and run in small batches. AI runs when requested (BACKGROUND_AI=on enables automatic reports)."
Stop-Transcript | Out-Null
Start-Sleep -Seconds 6

} finally { $launchLock.ReleaseMutex(); $launchLock.Dispose() }
