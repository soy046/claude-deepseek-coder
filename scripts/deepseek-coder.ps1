# deepseek-coder.ps1 - runs one coding step on DeepSeek through a headless Claude Code process.
# Windows PowerShell 5.1. Run from the project root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <plugin>/scripts/deepseek-coder.ps1 -SpecFile <spec.md> [-ResumeSession <id>]
# Exit codes: 0 success, 1 failure, 3 refused by the recursion guard.
param(
    [Parameter(Mandatory = $true)][string]$SpecFile,
    [string]$ResumeSession
)
$ErrorActionPreference = 'Stop'

function Fail([string]$Message, [int]$Code = 1) {
    [Console]::Error.WriteLine("deepseek-coder: $Message")
    exit $Code
}

if ($env:DEEPSEEK_CODER_ACTIVE -eq '1') { Fail 'refusing to start inside a coder run (recursion guard)' 3 }
if (-not $env:DEEPSEEK_API_KEY) { Fail 'DEEPSEEK_API_KEY is not set' }
if (-not (Test-Path -LiteralPath $SpecFile)) { Fail "spec file not found: $SpecFile" }
$SpecFile = (Resolve-Path -LiteralPath $SpecFile).Path

$scripts = $PSScriptRoot
$projectDir = (Get-Location).Path
if (-not (Test-Path -LiteralPath (Join-Path $projectDir '.claude\deepseek-coder.json'))) {
    Fail 'no .claude/deepseek-coder.json in this project; run /deepseek-coder:delegate so the planner can create it'
}

# PowerShell 5.1 talks to native programs in the ANSI code page by default; force UTF-8 both ways
$utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8

$cfgJson = & node (Join-Path $scripts 'resolve-config.js') --project $projectDir
if ($LASTEXITCODE -ne 0) { exit 1 }  # resolve-config.js already printed the reason
$cfg = ($cfgJson -join "`n") | ConvertFrom-Json

$role = @'
You are the CODING agent. A separate planner wrote the spec you receive on stdin.
Implement exactly what the spec says. Do not redesign or expand the scope.
Never delegate work and never run the deepseek-coder scripts.
You may only run the shell commands you are allowed. If a command you need is denied, say so in your report.
When finished, report: files changed, commands run and their results, and anything you could not do.
'@
if ($cfg.extraInstructions) { $role += "`n`nProject instructions:`n" + $cfg.extraInstructions }
$promptFile = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($promptFile, $role, $utf8)

# Everything below applies only to this process and the coder it starts.
# Drop the parent session's variables first: a host app (e.g. the Claude desktop app) passes its own
# auth and session wiring down, and the coder would use that instead of the DeepSeek key.
$keepVars = @('CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CODE_SHELL', 'CLAUDE_CODE_SHELL_PREFIX', 'CLAUDE_CODE_USE_POWERSHELL_TOOL')
Get-ChildItem Env: |
    Where-Object { $_.Name -match '^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDECODE$|CLAUDE_PID$)' -and $keepVars -notcontains $_.Name } |
    ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
$env:DEEPSEEK_CODER_ACTIVE = '1'
$env:ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
$env:ANTHROPIC_AUTH_TOKEN = $env:DEEPSEEK_API_KEY
$env:ANTHROPIC_MODEL = $cfg.model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $cfg.model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = $cfg.model
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $cfg.smallModel
$env:CLAUDE_CODE_SUBAGENT_MODEL = $cfg.smallModel
if ($cfg.model -match '\[1m\]$') { $env:CLAUDE_CODE_AUTO_COMPACT_WINDOW = '786432' }
$env:API_TIMEOUT_MS = '600000'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'

$cliArgs = @(
    '-p', 'Implement the spec provided on stdin. Follow it exactly.',
    '--append-system-prompt-file', $promptFile,
    '--permission-mode', 'acceptEdits',
    '--strict-mcp-config',
    '--max-turns', "$($cfg.maxTurns)",
    '--output-format', 'json',
    '--disallowedTools', 'Bash(powershell:*)', 'Bash(pwsh:*)', 'Bash(bash:*)', 'Bash(sh:*)', 'Bash(git push:*)',
    'PowerShell', 'WebFetch', 'WebSearch', 'Skill', 'Agent',
    '--allowedTools'
) + @($cfg.allowedTools)
if ($ResumeSession) { $cliArgs = @('--resume', $ResumeSession) + $cliArgs }

$logPath = [IO.Path]::ChangeExtension($SpecFile, '.json')
& node (Join-Path $scripts 'run-marker.js') touch
try {
    $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $SpecFile | & claude @cliArgs
    $claudeExit = $LASTEXITCODE
}
finally {
    Remove-Item -LiteralPath $promptFile -ErrorAction SilentlyContinue
    & node (Join-Path $scripts 'run-marker.js') touch
}
[IO.File]::WriteAllText($logPath, ($raw | Out-String).Trim(), $utf8)

& node (Join-Path $scripts 'print-result.js') $logPath $cfg.model
if ($claudeExit -ne 0 -or $LASTEXITCODE -ne 0) { exit 1 }
exit 0
