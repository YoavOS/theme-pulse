param([ValidateSet('backend','app','watch')][string]$Kind)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'
$log = Join-Path $PSScriptRoot ("logs\$Kind-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.log')
if ($Kind -eq 'backend') {
  npx --yes supabase@3.2.0 functions serve --env-file supabase\functions\.env *> $log
} elseif ($Kind -eq 'watch') {
  # rebuilds the website after updates so a page refresh shows them (see watch-build.mjs)
  node local\watch-build.mjs *> $log
} else {
  node node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 8080 --strictPort *> $log
}
exit $LASTEXITCODE
