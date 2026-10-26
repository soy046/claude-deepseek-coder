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
2. **Config.** If `.deepseek-coder/config.json` does not exist:
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
     - No: set `"gitMode": "none"` in `.deepseek-coder/config.json` and continue without git.
   - A repo with uncommitted changes (`git status --porcelain` is not empty) and `gitMode` `commit` or `stage`:
     tell the user those changes would mix with DeepSeek's and ask how to proceed before going on.

## 2. Plan

1. Explore just enough of the codebase to plan the goal.
2. Split the goal into small, ordered steps. Each step should be finishable by DeepSeek within its `maxTurns`.
3. Create the run folder `.deepseek-coder/plans/<YYYY-MM-DD-HHMM>-<slug>/` (local time; slug is 2-5 kebab-case words from the goal).
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
   - `gitMode` `commit` or `stage`: run `git add -N -- . ":(exclude).deepseek-coder"` then `git diff` (earlier accepted steps are committed or staged,
     so the diff is this step only).
   - `gitMode` `none`: read every file the coder reports changing.
   - Check every acceptance criterion and run the spec's verify commands yourself.

f. **Fix rounds.** If the step is wrong, for fix round K (1 to `maxFixRounds`): write `<run folder>/step-NN-fixK.md`
   listing each problem concretely (file, line or function, expected vs actual) and the change needed. Run the coder
   with that spec and the resume option set to the `SESSION_ID` from the latest output. Review again (e).
   After `maxFixRounds` failed fix rounds: **stop and ask the user.** Show the spec, the latest report and the failing
   checks. Leave the run marker in place. If the user tells you to edit the code yourself, end the run first (marker `stop`).

g. **Show the changes.** Once the step passes review, show the user what DeepSeek changed, in the conversation,
   before accepting it. Leave out the plugin's own files in `.deepseek-coder/`.
   - `gitMode` `commit` or `stage`: run `git add -N -- . ":(exclude).deepseek-coder"`, then
     `git diff --name-status -- . ":(exclude).deepseek-coder"` and `git diff --numstat -- . ":(exclude).deepseek-coder"`,
     and show one line per file with its status letter and `+added -removed` counts:

     ```
     Step NN changed 2 files:
       M src/math.js        +4 -1
       A src/util.js        +12 -0
     ```
     Then run `git diff -- . ":(exclude).deepseek-coder"` and show the full diff in a ```diff code block, without trimming it.
   - `gitMode` `none`: show the list of files DeepSeek reports changing, one per line, with no code.

h. **Accept.**
   - `commit`: `git add -A -- . ":(exclude).deepseek-coder/plans/.run-active"`, then commit with a Conventional Commits message (`<type>(<scope>): <summary>`, optional body),
     ending with exactly these trailers, where `<model>` is the `MODEL` line from the coder output:

     ```
     Co-Authored-By: Claude <noreply@anthropic.com>
     Co-Authored-By: DeepSeek <model> <noreply@deepseek.com>
     ```
   - `stage`: `git add -A -- . ":(exclude).deepseek-coder/plans/.run-active"`.
   - `none`: nothing.

## 4. Finish

1. End the run: marker `stop`.
2. Summarize: each step, what DeepSeek implemented, which fix rounds were needed and why, final test results,
   and the run folder path. Include a combined list of every file changed in the run (outside `.deepseek-coder/`),
   one line per file with its status letter, `+added -removed` totals and the step numbers that touched it
   (with `gitMode` `none`: file names and step numbers only):

   ```
   Files changed in this run:
     M src/math.js        +9 -2   (steps 01, 02)
     A src/util.js        +12 -0  (step 02)
   ```
3. If `gitMode` is `commit` and `git remote` lists a remote, ask the user whether to push. Never push without a yes.

## Rules

- Never edit source files yourself during a run. Only the run folder and `.deepseek-coder/config.json` are yours.
- Never delete run folders or spec files.
- Never write the API key into a file or a command.
