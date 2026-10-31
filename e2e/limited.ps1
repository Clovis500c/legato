# Runs a command as this user without its administrator rights and waits for it: its output comes here at the end, its
# exit code is this script's. GitHub's Windows runners run as an elevated administrator, and there WebView2 starts
# without --remote-debugging-port (runtime 155: the other flags arrive, the app works, the port stays shut). The walk
# needs that port, so CI runs it through here.
param([Parameter(Mandatory, ValueFromRemainingArguments)] [string[]] $Command)

$work = New-Item -ItemType Directory -Force -Path (Join-Path ([IO.Path]::GetTempPath()) "legato-limited-$PID")
$log = Join-Path $work 'out.log'
$code = Join-Path $work 'code.txt'
$run = Join-Path $work 'run.cmd'

# runas /trustlevel takes no /env: this script's environment goes in the batch file.
$vars = Get-ChildItem env: | Where-Object { $_.Value -notmatch '[\r\n"]' -and $_.Name -notmatch '[=()]' } |
  ForEach-Object { "set `"$($_.Name)=$($_.Value -replace '%', '%%')`"" }
Set-Content -Path $run -Encoding ascii -Value (@('@echo off') + $vars + @(
  "cd /d `"$PWD`""
  "call $($Command -join ' ') > `"$log`" 2>&1"
  "> `"$code`" echo %errorlevel%"
))

# 0x20000 = Basic User: same account, Administrators disabled, medium integrity.
runas /trustlevel:0x20000 "cmd /c $run"
if ($LASTEXITCODE) { throw "runas failed ($LASTEXITCODE)" }

while (-not (Test-Path $code)) { Start-Sleep -Seconds 1 }
Start-Sleep -Milliseconds 200
if (Test-Path $log) { Get-Content $log }
exit [int](Get-Content $code -Raw).Trim()
