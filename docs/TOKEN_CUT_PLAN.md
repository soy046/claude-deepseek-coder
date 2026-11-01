# Plan: cutting Claude-side token use

This plan covers five pull requests that reduce the tokens the Claude planner spends during a delegation run, without making DeepSeek's results worse. It records the decisions made so far, what is finished, and what each remaining PR will change.

Decisions were settled on 2026-10-29. Status is as of 2026-11-01. Line numbers refer to `main` with PR 2 re-landed.

## Why

A review of the plugin (2026-10-27) found that the planner gave back much of what delegation saves:

- Claude re-typed every step's full diff in its reply (step 3g). Output tokens are Claude's most expensive kind.
- Claude read each diff twice, once in review and once to show it, and again after every fix round.
- Full test output landed in Claude's context on every verify run.
- Small tasks were delegated even when doing them directly would have cost fewer Claude tokens.

## Status

| PR | What | Version | Status |
|---|---|---|---|
| 1 (+1b) | Measure usage on both sides | 0.2.1 | Merged (#2) |
| 2 | One diff per step, from working-tree snapshots | 0.3.0 | Merged (#3), reverted (#4) to keep the baseline on 0.2.1, re-land open as #5 |
| 3 | Short test output, smaller fix rounds | 0.4.0 | Not started |
| 4 | Size check before delegating small tasks | 0.5.0 | Not started |
| 5 | Model names and the planner model | not set | Not started |

## Decisions

1. **Diff in the conversation:** `showDiff` defaults to `stat` (file list with `+/-` counts). `full` restores the full diff. Shipped in PR 2.
2. **Claude-side measurement:** read from the session transcript (PR 1b), best-effort because the transcript format is not a stable API. Shipped in PR 1.
3. **Short test output:** verify commands run through a new `run-check.js`. The docs tell users to add one allow rule, `node *run-check.js*`, so it does not prompt on every run.
4. **Skill trigger:** unchanged. Plain "implement X" or "fix Y" requests still start the `deepseek-delegation` skill. The PR 4 size check is the only guard against delegating small tasks.
5. **Releases:** one PR and one minor version bump at a time.
6. **DeepSeek credits:** ask before any run that spends them outside a normal delegation run (PR 5).

## Order and how we prove the savings

Order: PR 1 → PR 2 (built before the baseline ran) → baseline benchmark ×2 → re-land PR 2 → PRs 3, 4 → same benchmark ×2 → PR 5.

- **Runs:** twice before and twice after, because model output varies between runs.
- **Compare:** DeepSeek tokens (`usage.js <run folder>`), Claude tokens (`usage.js claude <run folder>`), the number of fix rounds, and whether the tests pass.
- **Success:** Claude-side output tokens drop clearly, and fix rounds and pass rate don't get worse.

The baseline runs on the installed plugin 0.2.1 (PR 1 in, PR 2 not), so it measures behaviour before PRs 2–4. PR 2 was merged as #3 and reverted as #4, so `main` is back to 0.2.1, and `autoUpdate` is off for the `soy046` marketplace. Don't update the plugin until both baseline runs are done.

To re-land PR 2 afterwards, revert the revert commit `782afac` on a new branch and open a PR. Merging `feat/step-diff` again does nothing, because its commits are already in `main`'s history.

### Benchmark setup (decided 2026-11-01)

**Repo:** a fresh clone of `D:\projects\deepseek-coder-sandbox` at `801ee27` per run, named `D:\projects\bench-<plugin version>-run<N>`. In each clone, remove the old run folders, write the config below, remove the `origin` remote and commit, so the tree is clean:

```bash
d=/d/projects/bench-<version>-run<N>
git clone -q /d/projects/deepseek-coder-sandbox "$d" && cd "$d"
git checkout -q 801ee27 -B main
git rm -r -q .deepseek-coder/plans
# write .deepseek-coder/config.json (below)
git remote remove origin
git add -A && git commit -q -m "bench: starting point (sandbox 801ee27, benchmark config)"
```

**Config** (`.deepseek-coder/config.json`):

```json
{
  "allowedCommands": ["npm test"],
  "model": "deepseek-flash[1m]",
  "maxTurns": 30,
  "extraInstructions": "",
  "approvalMode": "auto",
  "gitMode": "commit",
  "maxFixRounds": 3,
  "markerExpiryMinutes": 30,
  "deepseekPricing": {"input": 2, "cacheHit": 0.04, "output": 8, "currency": "CNY"}
}
```

Prices are DeepSeek's peak prices for `deepseek-flash` (CNY per 1M tokens). Off-peak prices are lower, so compare runs by tokens; the cost line is a fixed-price estimate.

**How each run is driven:** a new Claude Code session opened in the run folder, always with the same planner model. Paste the goal below exactly and answer any planner question the same way each time. Afterwards, run `usage.js` and `usage.js claude` on the run folder.

**Goal:**

```
/deepseek-coder:delegate Do this in exactly three steps, in order. Use only CommonJS and node:test, no new dependencies.
Step 1: in src/stats.js add and export mode(numbers): returns an array of every value that occurs most often, sorted ascending; throws Error('Cannot compute mode of empty array') on an empty array. Add tests to test/stats.test.js.
Step 2: in src/stats.js add and export variance(numbers, sample = false) and stddev(numbers, sample = false): population formula by default, sample formula (divide by n - 1) when sample is true; throw Error('Cannot compute variance of empty array') on an empty array, and Error('Sample variance needs at least 2 values') when sample is true and there are fewer than 2 values; stddev is Math.sqrt(variance). Add tests.
Step 3: create src/format.js exporting formatSummary(numbers), returning exactly 'count=<n> mean=<m> median=<md> mode=<a,b> stddev=<s>' where mean, median and stddev use toFixed(2), mode values are joined with ',' and stddev is the population one; empty array throws Error('Cannot summarize empty array'). Add test/format.test.js.
All tests must pass with npm test.
```

### Results

Claude numbers are for the whole planner session (planning included), from `usage.js claude`. "Since run start" covers only the part after the run marker started, so it leaves planning out.

| Run | Plugin | Planner model | Claude msgs | Claude output | Claude cache write | Claude cache read | Claude output since run start | DeepSeek input / cache read / output | DeepSeek turns | Est. DeepSeek cost | Fix rounds | Tests | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bench-0.2.1-run1 | 0.2.1 | Opus 5.5 medium | 22 | 15,809 | 55,484 | 1,850,892 | 12,626 | 50,565 / 256,384 / 6,851 | 25 | 0.1662 CNY | 0 | 41/41 pass | 8 min |
| bench-0.2.1-run2 | 0.2.1 | Opus 5.5 medium | 20 | 15,746 | 55,130 | 1,688,455 | 10,035 | 48,714 / 198,656 / 4,333 | 21 | 0.1400 CNY | 0 | 36/36 pass | 4 min |
| **Baseline average** | 0.2.1 | | 21 | 15,778 | 55,307 | 1,769,674 | 11,331 | 49,640 / 227,520 / 5,592 | 23 | 0.1531 CNY | 0 | pass | 6 min |

Both runs also passed a manual spot check with identical output: `mode([1,2,2,3,3])` is `[2,3]`, the population stddev of `[2,4,4,4,5,5,7,9]` is 2, `formatSummary([1,2,2,3,3])` is `count=5 mean=2.20 median=2.00 mode=2,3 stddev=0.75`, and all four error messages match the goal.

Run-to-run spread in the baseline: Claude whole-session output differed by under 1% (15,809 vs 15,746), Claude output since run start by about 20% (12,626 vs 10,035), and DeepSeek output by about 37% (6,851 vs 4,333). Treat changes smaller than that spread as noise.

The planner asked a different set of questions in each run (below), so part of the spread comes from planning. In every case the user picked the recommended option; do the same in later runs.

**Planner questions in run 2:**
- mode() when every value occurs once: all values, sorted.
- Validate non-array or non-numeric input: no, out of scope.
- formatSummary reuses mean, median, mode and stddev from `src/stats.js`: yes.
- Confirmed facts and test coverage: both correct.

**Planner questions in run 1:**
- variance() reuses the existing mean(): yes.
- Floating-point tests: exact where exact, tolerance otherwise.
- Mode values in `mode=<a,b>`: raw values.
- formatSummary checks for an empty array itself first, and mode/variance leave the input unmutated: yes to both.
- `variance([], true)` throws the empty-array error (checked first).

### Control: Claude alone, no plugin (2026-11-01)

The same goal done by Claude without the plugin, to see whether delegating saves Claude tokens at all.

**Setup:** fresh clones `D:\projects\bench-claude-run1` and `-run2` at `801ee27`, with `.deepseek-coder/` removed and the plugin turned off for those folders by a committed `.claude/settings.json` (`"deepseek-coder@soy046": false`). Same planner model (Opus 5.5 medium), same front end (desktop app, CLI 2.1.309). Measured with `usage.js claude` on a folder outside the repo holding a hand-written `run.json`; copies of each transcript are in `D:\projects\bench-results\`.

**Prompt:** the goal text without `/deepseek-coder:delegate`, plus this last paragraph so Claude follows the same plan-then-implement workflow:

```
Work like this: first explore the code and ask me about anything the goal leaves open, then show a numbered plan of the three steps and continue without waiting for approval. Then for each step: implement it yourself, run npm test, and commit the step separately with a Conventional Commits message.
```

| Run | Claude msgs | Claude output | Claude cache write | Claude cache read | Questions asked | Commits | Tests | Wall time |
|---|---|---|---|---|---|---|---|---|
| bench-claude-run1 | 9 | 4,908 | 28,356 | 612,909 | 0 | 3 | 29/29 pass | 75 s |
| bench-claude-run2 | 10 | 5,752 | 29,172 | 686,389 | 2 | 3 | 30/30 pass | 91 s |
| **Claude-only average** | 10 | 5,330 | 28,764 | 649,649 | 1 | 3 | pass | 83 s |
| Delegated average (0.2.1) | 21 | 15,778 | 55,307 | 1,769,674 | 4–5 | 3 | pass | 6 min |

Both runs passed the same spot check as the delegated runs, with identical output. Run 2's questions (mode when every value occurs once; how to print mode values) got the recommended answers.

**Finding:** on this task (about 130 added lines in 4 files), delegating on 0.2.1 cost the planner about 3× the output tokens (15.8k vs 5.3k), 1.9× the cache writes and 2.7× the cache reads of doing the work in Claude, plus about 0.15 CNY of DeepSeek and 4× the wall time. The delegated runs did write more tests (41 and 36 vs 29 and 30). So for a task this size, delegation has to cut Claude-side tokens by about two thirds just to break even. The after-PR 4 runs show how far PRs 2–4 close that gap, and PR 4's size threshold (about 30 lines in 1–2 files) may need to be higher.

## PR 3: short test output and smaller fix rounds (0.4.0)

**New `scripts/run-check.js --log <file> "<cmd>"`**
- Runs the command through a shell (`cmd.exe` on Windows) with `NO_COLOR=1`, and strips ANSI codes.
- Saves the full output to `<run folder>/step-NN-verify.log`.
- On pass, prints one line: `PASS <cmd> (exit 0, 8.2s)`.
- On fail, prints `FAIL`, the last 60 lines and the log path.
- Exits with the command's own exit code.

**`commands/delegate.md`**
- 3e (`delegate.md:112`): run verify commands only through `run-check.js`, with a long tool timeout for slow suites.
- 3f (`delegate.md:114-120`): fix specs list only the problems and the changes needed, and never restate the original spec. Today nothing tells Claude not to restate it.
- 3d: if DeepSeek's report shows a failing verify command, write the fix spec straight away.

**Runner role prompts** (`deepseek-coder.ps1:40-41`, `deepseek-coder.sh:47-48`): the report must list each verify command run and its exit code. Both copies get the same edit.

**Config:** `maxFixRounds` stays at 3 until usage data shows how often round 3 succeeds.

**Docs:** the allow rule, the verify log, and the shorter fix specs in README, the user guide and the developer guide.

## PR 4: size check before delegating (0.5.0)

- **New step 1.0 in `delegate.md`,** before the run marker exists, so the edit guard doesn't block doing the task directly.
- **New config key `smallTaskPolicy`:** `ask` (default), `direct` or `delegate`.
  - `ask`: Claude says the task looks small and asks whether to do it directly.
  - `direct`: Claude does small tasks itself without a run.
  - `delegate`: always delegate, as today.
- **What counts as small:** a guideline in `delegate.md`, not a config key. Roughly 30 changed lines or fewer, in 1–2 files, with no test-and-fix loop expected.
- **Skill description** (`skills/deepseek-delegation/SKILL.md:3`): not narrowed (decision 4).
- **Docs:** `README.md:55`, the FAQ entry at `docs/USER_GUIDE.md:257`, and both config tables.

## PR 5: model names and the planner model

- Run a one-line test spec with `deepseek-flash[1m]`, `deepseek-flash` and `deepseek-v4-flash`. It costs a few cents of DeepSeek usage; ask first.
- Change the default `model` only if the test shows a difference.
- Document that planning and review run on the user's session model, and that Sonnet is the cheaper choice for the planner.

## Lessons from PRs 1 and 2

- `usage` in a coder log covers one whole coder run. `modelUsage` and `total_cost_usd` add up across `--resume` and use Claude prices, so never read them.
- Cache reads are most of DeepSeek's input, so cost estimates price them separately.
- Session transcripts write each assistant message several times. Count each `message.id` once.
- The run marker is deleted before the summary, so run data that the summary needs lives in `run.json` in the run folder.
- DeepSeek can only run `allowedCommands` (`node --test` here). Claude tests anything that needs a shell, such as the runner scripts, itself.

## Open questions

1. **PR 3 base branch:** start after PR 2 is re-landed on `main`, or branch from the re-land branch before it merges?
2. **PR 5 version:** bump only if defaults or code change, or always?
3. **PR 4 size threshold:** the Claude-only control did a ~130-line, 4-file task with a third of the delegated Claude output. Raise the "small" guideline above ~30 lines in 1–2 files, and to what?
