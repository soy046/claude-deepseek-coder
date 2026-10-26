#!/usr/bin/env bash
# deepseek-coder.sh - runs one coding step on DeepSeek through a headless Claude Code process.
# macOS/Linux. Run from the project root:
#   bash <plugin>/scripts/deepseek-coder.sh --spec-file <spec.md> [--resume-session <id>]
# Exit codes: 0 success, 1 failure, 3 refused by the recursion guard.
set -euo pipefail

fail() { echo "deepseek-coder: $1" >&2; exit "${2:-1}"; }

SPEC=""
RESUME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec-file) SPEC="${2:-}"; shift 2 ;;
    --resume-session) RESUME="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

if [ "${DEEPSEEK_CODER_ACTIVE:-}" = "1" ]; then fail "refusing to start inside a coder run (recursion guard)" 3; fi
[ -n "${DEEPSEEK_API_KEY:-}" ] || fail "DEEPSEEK_API_KEY is not set"
[ -n "$SPEC" ] || fail "usage: deepseek-coder.sh --spec-file <spec.md> [--resume-session <id>]"
[ -f "$SPEC" ] || fail "spec file not found: $SPEC"
SPEC="$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")"

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(pwd)"
[ -f "$PROJECT/.deepseek-coder/config.json" ] ||
  fail "no .deepseek-coder/config.json in this project; run /deepseek-coder:delegate so the planner can create it"

get() { node "$SCRIPTS/resolve-config.js" --project "$PROJECT" --get "$1"; }
MODEL="$(get model)"
SMALL_MODEL="$(get smallModel)"
MAX_TURNS="$(get maxTurns)"
EXTRA="$(get extraInstructions)"
TOOLS=()
while IFS= read -r line; do
  if [ -n "$line" ]; then TOOLS+=("$line"); fi
done < <(get allowedTools)

PROMPT_FILE="$(mktemp)"
trap 'rm -f "$PROMPT_FILE"' EXIT
cat > "$PROMPT_FILE" <<'EOF'
You are the CODING agent. A separate planner wrote the spec you receive on stdin.
Implement exactly what the spec says. Do not redesign or expand the scope.
Never delegate work and never run the deepseek-coder scripts.
You may only run the shell commands you are allowed. If a command you need is denied, say so in your report.
When finished, report: files changed, commands run and their results, and anything you could not do.
EOF
if [ -n "$EXTRA" ]; then printf '\n\nProject instructions:\n%s\n' "$EXTRA" >> "$PROMPT_FILE"; fi

# Everything below applies only to this process and the coder it starts.
# Drop the parent session's variables first: a host app (e.g. the Claude desktop app) passes its own
# auth and session wiring down, and the coder would use that instead of the DeepSeek key.
for v in $(compgen -e); do
  case "$v" in
    CLAUDE_CODE_GIT_BASH_PATH | CLAUDE_CODE_SHELL | CLAUDE_CODE_SHELL_PREFIX | CLAUDE_CODE_USE_POWERSHELL_TOOL) ;;
    ANTHROPIC_* | CLAUDE_CODE_* | CLAUDE_AGENT_SDK_* | CLAUDECODE | CLAUDE_PID) unset "$v" ;;
  esac
done
export DEEPSEEK_CODER_ACTIVE=1
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
export ANTHROPIC_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$SMALL_MODEL"
export CLAUDE_CODE_SUBAGENT_MODEL="$SMALL_MODEL"
case "$MODEL" in *"[1m]") export CLAUDE_CODE_AUTO_COMPACT_WINDOW=786432 ;; esac
export API_TIMEOUT_MS=600000
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

ARGS=(
  -p "Implement the spec provided on stdin. Follow it exactly."
  --append-system-prompt-file "$PROMPT_FILE"
  --permission-mode acceptEdits
  --strict-mcp-config
  --max-turns "$MAX_TURNS"
  --output-format json
  --disallowedTools "Bash(powershell:*)" "Bash(pwsh:*)" "Bash(bash:*)" "Bash(sh:*)" "Bash(git push:*)"
  PowerShell WebFetch WebSearch Skill Agent
  --allowedTools "${TOOLS[@]}"
)
if [ -n "$RESUME" ]; then ARGS=(--resume "$RESUME" "${ARGS[@]}"); fi

LOG="${SPEC%.md}.json"
node "$SCRIPTS/run-marker.js" touch
set +e
claude "${ARGS[@]}" < "$SPEC" > "$LOG"
CLAUDE_EXIT=$?
node "$SCRIPTS/run-marker.js" touch
node "$SCRIPTS/print-result.js" "$LOG" "$MODEL"
PRINT_EXIT=$?
set -e

if [ "$CLAUDE_EXIT" -ne 0 ] || [ "$PRINT_EXIT" -ne 0 ]; then exit 1; fi
exit 0
