# deepseek-coder developer guide

This guide is for people changing the plugin itself. For using it, see the [user guide](USER_GUIDE.md).

## Running the tests

The tests use Node's built-in test runner, so there is nothing to install. From the repository root:

```
node --test "scripts/test/*.test.js"
```

Keep the quotes: Node expands the pattern itself, so the command works the same in PowerShell and bash. Passing the folder (`node --test scripts/test/`) does not work.

- Tests live in `scripts/test/`, one file per script.
- Fixtures live in `scripts/__fixtures__/`: trimmed copies of real coder logs (`coder-*.json`) and a sample Claude session transcript (`transcript/`).
- Tests run the scripts as child processes in temporary folders, so they never touch your real `.deepseek-coder/` folder or Claude transcripts.

## Code layout

| File | What it does |
|---|---|
| `commands/delegate.md` | The `/deepseek-coder:delegate` command: the planner's step-by-step instructions for a run. |
| `commands/reset.md` | The `/deepseek-coder:reset` command: clears a leftover run marker. |
| `skills/claude-planning/SKILL.md` | The planner's rules: ask instead of inferring, write `plan.md`, check each spec, review specs with the user. `delegate.md` tells Claude to follow it. |
| `skills/deepseek-delegation/SKILL.md` | Lets Claude start a run on its own; it points to `delegate.md`. |
| `scripts/resolve-config.js` | Reads and validates `.deepseek-coder/config.json` and fills in defaults. Prints the whole config or one key (`--get`). |
| `scripts/run-marker.js` | Starts, refreshes, stops and reports the run marker. `start` also writes the run folder's `run.json`. |
| `scripts/deepseek-coder.ps1`, `scripts/deepseek-coder.sh` | Run one spec on DeepSeek through a headless Claude Code process (Windows and macOS/Linux). |
| `scripts/print-result.js` | Turns a coder log into the summary the planner reads, including the `USAGE` line, and appends the run to `usage.jsonl`. |
| `scripts/usage.js` | Token usage: the DeepSeek table for a run folder (`usage.js <run folder>`) and the Claude table from the session transcript (`usage.js claude <run folder>`). |
| `hooks/hooks.json`, `hooks/edit-guard.js` | The edit guard: during a run, blocks the planner from editing source files, and records the planner's transcript path in `run.json`. |

How they call each other:

- The runner scripts call `resolve-config.js` for the settings, `run-marker.js touch` before and after the coder, and `print-result.js` on the coder's log.
- `print-result.js` uses `usage.js`, which gets `deepseekPricing` from `resolve-config.js --get`.
- `run-marker.js` and `edit-guard.js` call `resolve-config.js --get markerExpiryMinutes`.

## Run folder files

Each run gets a folder `.deepseek-coder/plans/<date-time>-<slug>/`. The run marker itself is `.deepseek-coder/plans/.run-active`, outside the run folder.

| File | Written by | Contents |
|---|---|---|
| `plan.md` | the planner | The user's decisions, the confirmed facts and the step list. |
| `step-NN.md` | the planner | The spec for step NN. |
| `step-NN-fixK.md` | the planner | Fix round K for step NN. |
| `step-NN.json`, `step-NN-fixK.json` | the runner script | The coder's raw JSON output for that spec. |
| `usage.jsonl` | `print-result.js` | One line per coder run: `at, spec, sessionId, turns, status, error, input, cacheRead, cacheWrite, output`. |
| `run.json` | `run-marker.js start`, then `edit-guard.js` | `startedAt`, and the planner's `transcriptPath` once the planner writes into the run folder. |
