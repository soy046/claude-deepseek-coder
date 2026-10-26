---
description: Plan a change with Claude, have DeepSeek write the code, then review it
argument-hint: <what to build or change>
---

# DeepSeek delegation run

Goal: $ARGUMENTS

You are the PLANNER. DeepSeek is the CODER. You explore, plan, write specs, review and test.
DeepSeek writes the code. During a run you never edit source files yourself; a hook blocks it.

Run every command below from the project root. Plugin scripts:

| Purpose | Command |
|---|---|
| Resolved config | `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-config.js"` |
| Run marker | `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-marker.js" <start "<run folder>" \| stop \| status>` |
| Coder, Windows | `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/deepseek-coder.ps1" -SpecFile "<spec>" [-ResumeSession <id>]` |
| Coder, macOS/Linux | `bash "${CLAUDE_PLUGIN_ROOT}/scripts/deepseek-coder.sh" --spec-file "<spec>" [--resume-session <id>]` |

The coder prints DeepSeek's report followed by `SESSION_ID`, `MODEL`, `TURNS / STATUS / ERROR` and `LOG` lines.
Exit code 0 means the run finished, 1 means it failed (including hitting the turn limit), 3 means the recursion guard refused it.

## 1. Preflight

1. **Existing run.** Run the marker `status`. If it prints `active`, another run is in progress or crashed recently:
   tell the user and ask whether to stop or to clear it (`stop`) and continue. `expired` or `none` means continue.
2. **Config.** If `.claude/deepseek-coder.json` does not exist:
   - Inspect the project (package.json scripts, pyproject.toml, Makefile, etc.) to find its test, lint and build commands.
   - Propose a complete config to the user showing every key: `allowedCommands` (what you found), `model`, `maxTurns`,
     `extraInstructions`, `approvalMode` (`plan` | `step` | `auto`), `gitMode` (`commit` | `stage` | `none`),
     `maxFixRounds`, `markerExpiryMinutes`. Show the plugin defaults for the others
     (run the resolve-config command to see them). Explain that `allowedCommands` entries are prefix matches and are
     the only shell commands DeepSeek may run.
   - Write the file only after the user approves it, with any changes they ask for.
3. **Resolve.** Run the resolve-config command. If it fails, show the error and stop.
   Use its `approvalMode`, `gitMode`, `maxFixRounds` for the rest of the run.
4. **Git.** Run `git rev-parse --is-inside-work-tree`.
   - Not a repo and `gitMode` is `none`: continue without git.
   - Not a repo and `gitMode` is `commit` or `stage`: ask the user whether they want to work with git.
     - Yes: ask permission to run `git init`, then run it. Then ask whether to commit the existing files
       as an initial commit before any step runs, and do what they say.
     - No: set `"gitMode": "none"` in `.claude/deepseek-coder.json` and continue without git.
   - A repo with uncommitted changes (`git status --porcelain` is not empty) and `gitMode` `commit` or `stage`:
     tell the user those changes would mix with DeepSeek's and ask how to proceed before going on.

## 2. Plan

1. Explore just enough of the codebase to plan the goal.
2. Split the goal into small, ordered steps. Each step should be finishable by DeepSeek within its `maxTurns`.
3. Create the run folder `.claude/deepseek-plans/<YYYY-MM-DD-HHMM>-<slug>/` (local time; slug is 2-5 kebab-case words from the goal).
4. Follow `approvalMode`:
   - `plan`: show the numbered step list (title and one-line scope each) and wait for the user's approval. Revise if asked.
   - `step`: show the step list for information, then ask approval before every delegation (section 3b).
   - `auto`: show the step list and continue without waiting.
5. Start the run: marker `start "<run folder>"`.

## 3. For each step NN (01, 02, ...)

a. **Spec.** Write `<run folder>/step-NN.md`:

```markdown
# Step NN: <title>
## Goal
## Files to create or change
## Required interfaces (exact signatures, types, routes, schemas)
## Constraints (style, libraries to use or avoid)
## Acceptance criteria
## Verify with (only commands from allowedCommands)
## Out of scope
```

b. **Approval** (`step` mode only): show the spec and wait for approval.

c. **Delegate.** Run the coder command for this OS with the spec path, **in the background** (`run_in_background`).
   Wait for the completion notification; do not poll it and do not change files meanwhile.

d. **Read the result.** Exit 3: stop the run and tell the user the recursion guard fired.
   Exit 1 or `ERROR: true`: count it as a failed attempt and go to (f).

e. **Review.** Never trust DeepSeek's report alone.
   - `gitMode` `commit` or `stage`: run `git add -N .` then `git diff` (earlier accepted steps are committed or staged,
     so the diff is this step only).
   - `gitMode` `none`: read every file the coder reports changing.
   - Check every acceptance criterion and run the spec's verify commands yourself.

f. **Fix rounds.** If the step is wrong, for fix round K (1 to `maxFixRounds`): write `<run folder>/step-NN-fixK.md`
   listing each problem concretely (file, line or function, expected vs actual) and the change needed. Run the coder
   with that spec and the resume option set to the `SESSION_ID` from the latest output. Review again (e).
   After `maxFixRounds` failed fix rounds: **stop and ask the user.** Show the spec, the latest report and the failing
   checks. Leave the run marker in place. If the user tells you to edit the code yourself, end the run first (marker `stop`).

g. **Accept.**
   - `commit`: `git add -A`, then commit with a Conventional Commits message (`<type>(<scope>): <summary>`, optional body),
     ending with exactly these trailers, where `<model>` is the `MODEL` line from the coder output:

     ```
     Co-Authored-By: Claude <noreply@anthropic.com>
     Co-Authored-By: DeepSeek <model> <noreply@deepseek.com>
     ```
   - `stage`: `git add -A`.
   - `none`: nothing.

## 4. Finish

1. End the run: marker `stop`.
2. Summarize: each step, what DeepSeek implemented, which fix rounds were needed and why, final test results,
   and the run folder path.
3. If `gitMode` is `commit` and `git remote` lists a remote, ask the user whether to push. Never push without a yes.

## Rules

- Never edit source files yourself during a run. Only the run folder and `.claude/deepseek-coder.json` are yours.
- Never delete run folders or spec files.
- Never write the API key into a file or a command.
