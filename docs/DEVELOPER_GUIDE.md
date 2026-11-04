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
| `scripts/resolve-config.js` | Reads and validates `.deepseek-coder/config.json` and fills in defaults. Prints the whole config, one key (`--get`), or a turn limit capped at `maxTurns` (`--turns <N>`). |
| `scripts/run-marker.js` | Starts, refreshes, stops and reports the run marker. `start` also writes the run folder's `run.json`; `allow <path>...` adds files the planner may write during the run to the marker's `allowed` list. |
| `scripts/deepseek-coder.ps1`, `scripts/deepseek-coder.sh` | Run one spec on DeepSeek through a headless Claude Code process (Windows and macOS/Linux). |
| `scripts/print-result.js` | Turns a coder log into the summary the planner reads, including the `TURNS` and `USAGE` lines, and appends the run to `usage.jsonl`. The runners pass `--since <start time>` and `--cap <turn limit>`; the reply and tool-call counts come from `usage.js` `coderReplies`, which reads the coder's session transcript (`<CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/<session id>.jsonl`), counting only messages since the start time because `--resume` reuses the session. |
| `scripts/usage.js` | Token usage: the DeepSeek table for a run folder (`usage.js <run folder>`) and the Claude table from the session transcript (`usage.js claude <run folder>`). |
| `scripts/step-diff.js` | Working-tree snapshots through a private git index, and change lists between them: `snap`, `diff`, `stat` (one step) and `run` (the whole run, with step numbers). |
| `scripts/run-check.js` | Runs one verify command for the planner through the shell with `NO_COLOR=1`. Prints one `PASS` line, or `FAIL`, the last 60 lines and the log path; appends the full ANSI-stripped output to the log; exits with the command's exit code. |
| `hooks/hooks.json`, `hooks/edit-guard.js` | The edit guard: during a run, blocks the planner from editing source files other than those in the marker's `allowed` list, and records the planner's transcript path in `run.json`. |

How they call each other:

- The runner scripts call `resolve-config.js` for the settings (with `--turns` when given a turn limit), `run-marker.js touch` before and after the coder, and `print-result.js` on the coder's log.
- `print-result.js` uses `usage.js`, which gets `deepseekPricing` from `resolve-config.js --get`.
- `run-marker.js` and `edit-guard.js` call `resolve-config.js --get markerExpiryMinutes`.
- The runner scripts call `step-diff.js snap` right before the coder starts, naming the snapshot after the spec; `delegate.md` has the planner call `diff`, `stat` and `run`.
- `delegate.md` has the planner call `run-check.js` for a verify command whose `VERIFY` line is missing from DeepSeek's report, and for the final check. The runner scripts' role prompt asks DeepSeek to end its report with one `VERIFY <cmd> -> exit <N>` line per verify command.

## Run folder files

Each run gets a folder `.deepseek-coder/plans/<date-time>-<slug>/`. The run marker itself is `.deepseek-coder/plans/.run-active`, outside the run folder. It holds `startedAt`, `updatedAt`, `runDir` and, once the planner registers files, `allowed`.

| File | Written by | Contents |
|---|---|---|
| `plan.md` | the planner | The user's decisions, the confirmed facts and the step list. |
| `step-NN.md` | the planner | The spec for step NN. |
| `step-NN-fixK.md` | the planner | Fix round K for step NN. |
| `final-fixK.md` | the planner | Final fix round K, run in a new coder session when the final check fails. |
| `step-NN-verify.log`, `step-NN-fixK-verify.log`, `final-verify.log`, `final-fixK-verify.log` | `run-check.js` | The full output of every verify command the planner ran for that spec, appended, each entry under a `=== <cmd> \| <time> \| exit <N>, <secs>s ===` header. |
| `step-NN.json`, `step-NN-fixK.json` | the runner script | The coder's raw JSON output for that spec. |
| `usage.jsonl` | `print-result.js` | One line per coder run: `at, spec, sessionId, turns, replies, toolCalls, status, error, input, cacheRead, cacheWrite, output`. `turns` is the log's raw `num_turns` (tool calls + 1 on success, the limit + 1 on `error_max_turns`); `replies` and `toolCalls` are `null` when the transcript wasn't found. |
| `run.json` | `run-marker.js start`, then `edit-guard.js` | `startedAt`, and the planner's `transcriptPath` once the planner writes into the run folder. |
| `.snap-<name>`, e.g. `.snap-step-01`, `.snap-step-01-fix1` | the runner script, via `step-diff.js snap` | The git tree hash of the working tree just before that spec's coder run. The first snapshot for a name is kept if a spec runs again. |
