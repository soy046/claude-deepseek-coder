---
description: Plan a change with Claude, have DeepSeek write the code, then review it
argument-hint: <what to build or change>
---

# DeepSeek delegation run

Goal: $ARGUMENTS

You are the PLANNER. DeepSeek is the CODER. You explore, plan, write specs, review and test.
DeepSeek writes the code. During a run you never edit source files yourself; a hook blocks it.

Before you start, read `${CLAUDE_PLUGIN_ROOT}/skills/claude-planning/SKILL.md` and follow it for the whole run.
It decides how you ask questions, write the plan and specs, and get each spec reviewed.

Run every command below from the project root. Plugin scripts:

| Purpose | Command |
|---|---|
| Resolved config | `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-config.js"` |
| Run marker | `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-marker.js" <start "<run folder>" \| stop \| status>` |
| Coder, Windows | `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/deepseek-coder.ps1" -SpecFile "<spec>" [-ResumeSession <id>] [-MaxTurns <N>]` |
| Coder, macOS/Linux | `bash "${CLAUDE_PLUGIN_ROOT}/scripts/deepseek-coder.sh" --spec-file "<spec>" [--resume-session <id>] [--max-turns <N>]` |
| Usage tables | `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.js" "<run folder>"` (DeepSeek) and `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.js" claude "<run folder>"` (Claude) |
| Step diffs | `node "${CLAUDE_PLUGIN_ROOT}/scripts/step-diff.js" <diff "<run folder>" <name> \| stat "<run folder>" <NN> \| run "<run folder>">` |
| Verify check | `node "${CLAUDE_PLUGIN_ROOT}/scripts/run-check.js" --log "<log>" "<cmd>"` (run it with the maximum tool timeout, 600000 ms) |

The coder prints DeepSeek's report followed by `SESSION_ID`, `MODEL`, `TURNS / STATUS / ERROR`, `USAGE`,
`EST. DEEPSEEK COST` (only when `deepseekPricing` is set) and `LOG` lines. `TURNS` shows DeepSeek's replies (what the turn limit
counts) with the run's cap, and the tool calls they made; `?` means the coder's transcript wasn't found. DeepSeek's report ends with one
`VERIFY <cmd> -> exit <N>` line for each command in the spec's "Verify with" section.
Run-check prints one `PASS` line when the command passes. When it fails it prints a `FAIL` line, the last 60 lines of
output and the log path. It appends the full output to the log you name: `<run folder>/<spec name>-verify.log`
(`step-01-verify.log`, `step-01-fix1-verify.log`, `final-verify.log`, `final-fix1-verify.log`).
Right before each coder run, the coder command snapshots the working tree, named after the spec (`step-01`, `step-01-fix1`).
Exit code 0 means the run finished, 1 means it failed (including hitting the turn limit), 3 means the recursion guard refused it.

## 1. Preflight

1. **Existing run.** Run the marker `status`. If it prints `active`, another run is in progress or crashed recently:
   tell the user and ask whether to stop or to clear it (`stop`) and continue. `expired` or `none` means continue.
2. **Size check.** Run the resolve-config command with `--get smallTaskPolicy`. Without a config file it prints the
   default, `ask`. If it fails, skip this item; item 4 shows the error. If it prints `delegate`, skip this item.
   Otherwise estimate the size of the goal from its text and a quick look at the code it names. The task is **small**
   if it clearly needs about 300 changed lines or fewer, in 6 files or fewer, tests included. If you can't tell,
   treat it as not small and continue; Plan item 2 checks again.
   - Small and `ask`: tell the user your estimate (about N changed lines in M files) and why it counts as small. Then
     ask whether to do it directly, with two options: "Do it directly (Recommended)" and "Delegate to DeepSeek
     anyway". If they pick delegate, continue with item 3 and don't check the size again in this run.
   - Small and `direct`: say in one line `This looks small (about N changed lines in M files), so I'll do it directly
     (smallTaskPolicy: direct).` and don't ask.
   - Doing it directly: stop following this file here and follow "Small tasks done directly" at the end instead.
3. **Config.** If `.deepseek-coder/config.json` does not exist:
   - Inspect the project (package.json scripts, pyproject.toml, Makefile, etc.) to find its test, lint and build commands.
   - Propose a complete config to the user showing every key: `allowedCommands` (what you found), `model`, `maxTurns`,
     `extraInstructions`, `approvalMode` (`plan` | `step` | `auto`), `gitMode` (`commit` | `stage` | `none`),
     `maxFixRounds`, `markerExpiryMinutes`, `deepseekPricing` (propose `null`; item 5 sets it), `showDiff`
     (`stat` | `full`), `smallTaskPolicy` (`ask` | `direct` | `delegate`). Show the plugin defaults for the others
     (run the resolve-config command to see them). Explain that `allowedCommands` entries are prefix matches and are
     the only shell commands DeepSeek may run.
   - Write the file only after the user approves it, with any changes they ask for.
4. **Resolve.** Run the resolve-config command. If it fails, show the error and stop.
   Use its `approvalMode`, `gitMode`, `maxFixRounds`, `showDiff` for the rest of the run.
5. **Pricing.** If the resolved `deepseekPricing` is `null`:
   - Ask the user which currency to record DeepSeek prices in (3 uppercase letters, e.g. `USD` or `CNY`), or whether
     to skip pricing for this run. Skip: leave `deepseekPricing` as it is and continue. The usage tables then show
     tokens without a cost, and you ask again in the next run.
   - Look up DeepSeek's current API prices for the resolved `model` in that currency on DeepSeek's own pricing page:
     per 1M input tokens on a cache miss, per 1M input tokens on a cache hit, and per 1M output tokens.
     Never use remembered or estimated prices.
   - For every price you could not find, or all three if you cannot look them up, ask the user. Keep asking until
     all three prices are known.
   - Show the user the three prices, the currency, the model they apply to, and the source of each (the page URL,
     or "you" for a price the user gave). Write them to `.deepseek-coder/config.json` as
     `"deepseekPricing": {"input": <cache miss>, "cacheHit": <cache hit>, "output": <output>, "currency": "<code>"}`
     only after the user confirms or corrects them. Then run the resolve-config command again; if it fails, show the
     error and stop.
6. **Git.** Run `git rev-parse --is-inside-work-tree`.
   - Not a repo and `gitMode` is `none`: continue without git.
   - Not a repo and `gitMode` is `commit` or `stage`: ask the user whether they want to work with git.
     - Yes: ask permission to run `git init`, then run it. Then ask whether to commit the existing files
       as an initial commit before any step runs, and do what they say.
     - No: set `"gitMode": "none"` in `.deepseek-coder/config.json` and continue without git.
   - A repo with uncommitted changes (`git status --porcelain` is not empty) and `gitMode` `commit` or `stage`:
     tell the user those changes would mix with DeepSeek's and ask how to proceed before going on.

## 2. Plan

1. Explore the codebase and ask the user every open question, as the planning skill's sections 1 and 2 say.
   Do not go on until every point is a confirmed fact or a decision the user made.
2. Split the goal into small, ordered steps. Each step should be finishable by DeepSeek within `maxTurns` turns.
   For each step, estimate L, the lines DeepSeek will change. Its turn limit is T = max(10, min(maxTurns, ceil(L / 12))),
   so 300 lines get 25 turns. Step 01 runs in a new session. Every later step resumes the previous step's session if
   their "Files to create or change" lists share a path, and runs in a new session otherwise.
   If Preflight item 2 couldn't tell the task's size, and the plan now shows it is small (as defined there), tell
   the user so before you create the run folder, and apply `smallTaskPolicy` as Preflight item 2 says. If they pick
   doing it directly, or the policy is `direct`, follow "Small tasks done directly" with the plan you already have.
3. Create the run folder `.deepseek-coder/plans/<YYYY-MM-DD-HHMM>-<slug>/` (local time; slug is 2-5 kebab-case words from the goal),
   then write `plan.md` in it (planning skill, section 3).
4. Follow `approvalMode`:
   - `step` (the default): show the step list for information, then have the user review every spec before it is delegated (section 3b).
   - `plan`: show the numbered step list (title and one-line scope each) and wait for the user's approval. Revise if asked.
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

   A step that resumes the previous step's session may say "same conventions as step NN-1" and refer to earlier
   steps' files and interfaces instead of restating them; a step in a new session restates everything it needs.

   Then run the implement-ready check (planning skill, section 4).

b. **Approval** (`step` mode only): review the spec with the user as the planning skill's section 5 says.
   Show the full spec in your message and delegate only after the user explicitly approves it.

c. **Delegate.** Run the coder command for this OS with the spec path, the turn option set to the step's T, and, when
   the step resumes, the resume option set to the previous step's latest `SESSION_ID` (after its fix rounds). Run it
   **in the background** (`run_in_background`).
   Wait for the completion notification; do not poll it and do not change files meanwhile.

d. **Read the result.** Exit 3: stop the run and tell the user the recursion guard fired.
   `STATUS: error_max_turns`: review the step as in (e) anyway. If the diff meets every acceptance criterion and every
   verify command passes (run missing `VERIFY` lines with run-check), accept the step as normal; otherwise go to (f).
   Any other exit 1 or `ERROR: true`: count it as a failed attempt and go to (f).
   Read the result of a fix round or a final fix the same way.

e. **Review.** Review the diff, not whole files, and read DeepSeek's test results instead of running the tests again.
   - In a git repo (any `gitMode`): run step-diff `diff "<run folder>" step-NN` and read it. It shows everything this
     step changed since the snapshot taken before its first coder run. Note the names of the tests it added.
   - Not a git repo: read every file the coder reports changing.
   - Open a file, or part of one, only to settle a specific question the diff raises.
   - Check every acceptance criterion against the diff. Do not write extra tests, fuzzers or scratch scripts. If test
     coverage looks thin, say so in a fix spec and let DeepSeek add the tests.
   - **Tests.** Compare the `VERIFY` lines at the end of DeepSeek's report with the spec's "Verify with" commands:
     - Every command has a line with exit 0: the tests pass. Do not run them yourself.
     - Any line has a non-zero exit: the step fails. Go to (f) and write the fix spec straight away, without
       running anything first.
     - A command has no line: run it once with run-check, log `<run folder>/step-NN-verify.log`. `PASS`: it passes.
       `FAIL`: the step fails; go to (f).

f. **Fix rounds.** If the step is wrong, for fix round K (1 to `maxFixRounds`): write `<run folder>/step-NN-fixK.md`
   with exactly these sections:

   ```markdown
   # Step NN fix K
   ## Problems (file, line or function, expected vs actual)
   ## Changes needed
   ## Verify with
   ```

   List only the problems and the changes needed. Never restate the original spec: DeepSeek still has it in its
   resumed session. If a problem needs a decision the plan does not cover, ask the user first (planning skill,
   section 6). Run the implement-ready check, and in `step` mode review the fix spec with the user as in (b). Then run
   the coder with that spec, the resume option set to the `SESSION_ID` from the latest output, and the turn option set
   to the fix's own T (Plan item 2, from the fix's estimated changed lines). Review again as in
   (e): in a git repo, read only step-diff `diff "<run folder>" step-NN-fixK` (what this fix changed); without a repo,
   read the files the fix reports changing. Either way, check every acceptance criterion and apply the test rules
   from (e) to the fix's report, with run-check log `<run folder>/step-NN-fixK-verify.log`.
   After `maxFixRounds` failed fix rounds: **stop and ask the user.** Show the spec, the latest report and the failing
   checks. Leave the run marker in place. If the user tells you to edit the code yourself, end the run first (marker `stop`).

g. **Show the changes.** Once the step passes review, write a message to the user showing what DeepSeek changed,
   then continue to (h). The user does not see tool output, so running the commands below is not enough: copy their
   results into your message text. Do this for every step, in every `approvalMode`, before accepting it.
   Leave out the plugin's own files in `.deepseek-coder/`.
   - In a git repo: run step-diff `stat "<run folder>" NN` and copy its output into your message, for example:

     ```
     Step NN changed 2 files:
       M src/math.js   +4 -1
       A src/util.js   +12 -0
     ```
     - `showDiff` `stat`: below it, add the line `Full diff: ask me to show it.` If the user asks, run step-diff
       `diff "<run folder>" step-NN` and show it in a ```diff code block, without trimming it.
     - `showDiff` `full`: below it, run step-diff `diff "<run folder>" step-NN` and show it in a ```diff code block,
       without trimming it.
   - Not a git repo: show the list of files DeepSeek reports changing, one per line, with no code.

h. **Accept.**
   - `commit`: `git add -A -- .`, then `git rm -r -q --cached --ignore-unmatch -- .deepseek-coder/plans/.run-active`, then commit with a Conventional Commits message (`<type>(<scope>): <summary>`, optional body),
     ending with exactly these trailers, where `<model>` is the `MODEL` line from the coder output:

     ```
     Co-Authored-By: Claude <noreply@anthropic.com>
     Co-Authored-By: DeepSeek <model> <noreply@deepseek.com>
     ```
   - `stage`: `git add -A -- .`, then `git rm -r -q --cached --ignore-unmatch -- .deepseek-coder/plans/.run-active`.
   - `none`: nothing.

## 4. Finish

1. **Final check.** Collect every distinct command from the "Verify with" sections of the step specs (`step-NN.md`).
   If there are none, skip this item; the summary then says `Final check: no verify commands in any step.`
   Otherwise run each command once with run-check, log `<run folder>/final-verify.log`.
   - Every command prints `PASS`: go on to item 2.
   - Any `FAIL`: for final fix round K (1 to `maxFixRounds`), write `<run folder>/final-fixK.md` with the fix-spec
     sections from 3f, headed `# Final fix K`, listing the failing commands and the problems their output shows. If a
     problem needs a decision the plan does not cover, ask the user first. Run the implement-ready check, and in
     `step` mode review the spec with the user as in 3b. Run the coder with that spec in a **new** session (no resume
     option), because the fix can span several steps, with the turn option set to the fix's own T (Plan item 2). Review the change as in 3e: in a git repo, read step-diff
     `diff "<run folder>" final-fixK`; without a repo, read the files the fix reports changing. Then show the user
     what changed: list the changed files one per line, with no `+/-` counts. With `showDiff` `stat`, add the line
     `Full diff: ask me to show it.`; with `full`, show the diff in a ```diff code block, without trimming it.
     Accept it as in 3h, then run the final check again with the same log.
   - After `maxFixRounds` failed final fix rounds: **stop and ask the user.** Show the failing run-check output and
     the log path. Leave the run marker in place.
2. **Usage.** Run both usage-table commands with the run folder and keep their output.
3. End the run: marker `stop`.
4. Summarize: each step, what DeepSeek implemented, which fix rounds and final fix rounds were needed and why, the
   final check result (each command's `PASS` line, or that it was skipped), and the run folder path. Include the
   combined list of files changed in the run: in a git repo, run step-diff
   `run "<run folder>"` and copy its output unchanged, for example:

   ```
   Files changed in this run:
     M src/math.js   +9 -2   (steps 01, 02)
     A src/util.js   +12 -0  (step 02)
   ```
   Not a git repo: list each file the coder reported changing, with the step numbers that touched it.
   Then copy the output of both usage-table commands from item 2 into the summary unchanged, each in its own
   code block: first the DeepSeek table, then the Claude table.
5. If `gitMode` is `commit` and `git remote` lists a remote, ask the user whether to push. Never push without a yes.

## Small tasks done directly

When Preflight item 2 or Plan item 2 sends you here, you do the work yourself, without DeepSeek. There is no run
folder, `plan.md`, spec, run marker, usage table, commit or staging. No run marker exists, so the edit guard lets you
edit files.

1. **Plan.** Follow the planning skill's sections 1 and 2: confirm the facts with the user and ask every open
   question. If you came here from Plan item 2, that is already done. Then show a numbered step list (title and
   one-line scope each) and continue without waiting for approval.
2. **Edit.** Make the changes yourself, step by step.
3. **Test.** Run the project's test commands with run-check: the resolved `allowedCommands` that run tests, or, when
   there is no config, the test command you find in the project (package.json scripts, pyproject.toml, Makefile).
   Use the log `deepseek-coder-direct-verify.log` in the system temp directory, not in the project. On `FAIL`, fix
   the code and run it again.
4. **Summarize.** List the changed files one per line, copy each command's `PASS` line, and say that the changes are
   not committed or staged.

## Rules

- Never edit source files yourself during a run. Only the run folder and `.deepseek-coder/config.json` are yours.
- Never delete run folders or spec files.
- Never write the API key into a file or a command.
