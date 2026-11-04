# Plan: cutting Claude-side token use

This plan covers five pull requests that reduce the tokens the Claude planner spends during a delegation run, without making DeepSeek's results worse. It records the decisions made so far, what is finished, and what each remaining PR will change.

Decisions were settled on 2026-10-29 (PRs 3 and 4 on 2026-11-03). Status is as of 2026-11-03. Line numbers refer to `main` with PR 2 re-landed.

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
| 2 | One diff per step, from working-tree snapshots | 0.3.0 | Merged (#3), reverted (#4) to keep the baseline on 0.2.1, re-landed (#5) |
| 3 | Short test output, diff-only review, smaller fix rounds (plus a gitignore fix) | 0.4.0 | Merged (#6) |
| 4 | Size check before delegating small tasks | 0.5.0 | Merged (#7); one large-benchmark run done (see Results) |
| 5 | Model names and the planner model | not set | Not started |
| 6 | Optional smaller review model | not set | Proposed (2026-11-03) |

## Decisions

1. **Diff in the conversation:** `showDiff` defaults to `stat` (file list with `+/-` counts). `full` restores the full diff. Shipped in PR 2.
2. **Claude-side measurement:** read from the session transcript (PR 1b), best-effort because the transcript format is not a stable API. Shipped in PR 1.
3. **Short test output:** verify commands run through a new `run-check.js`. The docs tell users to add one allow rule, `node *run-check.js*`, so it does not prompt on every run.
4. **Skill trigger:** unchanged. Plain "implement X" or "fix Y" requests still start the `deepseek-delegation` skill. The PR 4 size check is the only guard against delegating small tasks.
5. **Releases:** one PR and one minor version bump at a time.
6. **DeepSeek credits:** ask before any run that spends them outside a normal delegation run (PR 5).

## Order and how we prove the savings

Order: PR 1 → PR 2 (built before the baseline ran) → baseline benchmark ×2 → re-land PR 2 → PRs 3, 4 → one large-benchmark run on 0.5.0 → PRs 5, 6 → large benchmark, two arms × 2 runs.

Once PR 4 is merged and the plugin is updated to 0.5.0, one large-benchmark run (`D:\projects\bench-large-0.5.0-run1`, set up and driven like the 0.2.1 large runs) gives an early look at PRs 2–4. It is a single run, so read it against the 34% run-to-run spread of the large 0.2.1 runs. The full after-PR 4 benchmark is skipped (decided 2026-11-03). One test runs after PR 6 is merged, on the large benchmark only: the small task now counts as small under PR 4, so it would mostly test the size check. It has two arms, 2 runs each: `reviewModel` unset, which measures PRs 2–4 against the large 0.2.1 runs, and `reviewModel` set, which measures PR 6 on top of that.

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

### Large-code experiment (set up 2026-11-03)

The control shows that delegating a ~130-line task costs Claude about 3× the output tokens. This experiment tests the other end: a task where the coder writes a lot of code. Claude's output tokens grow with the code it writes itself, while the planner's cost under delegation should grow mainly with the spec and review. If delegation ever saves Claude tokens, it should be here.

**Task:** build a small scripting language, Calc, in five steps: lexer, parser, interpreter with closures and built-ins, canonical pretty-printer, and CLI, each with its own test file. Expected size: about 1,200–1,500 added lines in 10 files. The goal spells out every AST shape, error message and output format, so results can be checked exactly. It is 842 words, against about 150 for the small benchmark.

**Arms:** Claude alone (no plugin) and delegated on plugin 0.2.1, 2 runs each. That's the same plugin as the baseline, so the large and small results compare directly. On 0.2.1 Claude re-types each step's full diff (step 3g), so expect that to inflate the delegated output; PR 2 removes it. A 0.3.0 arm can be added once PR #5 is installed.

**Folders:** `D:\projects\bench-large-0.2.1-run1`, `-run2`, `D:\projects\bench-large-claude-run1` and `-run2`, each a clean clone at `801ee27`, set up exactly like the small benchmark and the control (same config, plugin turned off in the Claude-only clones).

**Prompts and checker:** in `D:\projects\bench-results\large\`:
- `prompt-delegated.txt`: `/deepseek-coder:delegate` plus the goal.
- `prompt-claude.txt`: the goal plus the same "Work like this" paragraph as the control, with "five steps".
- `spotcheck.js`: 94 fixed checks of the public API (lexer 10, parser 21, interpreter 39, printer 16, CLI 8). Run `node D:\projects\bench-results\large\spotcheck.js <run folder>` after each run. It replaces the manual spot check, since the runs' own test suites will differ. Its expected values are hand-derived from the goal, so check any failure in the first run against the goal text before counting it.

**How each run is driven:** as before. Open a new session in the run folder with Opus 5.5 medium, paste the prompt file's contents, and pick the recommended option for every planner question. Record the questions. Afterwards, run `usage.js` and `usage.js claude` (delegated), or write a `run.json` and run `usage.js claude` (Claude-only, as in the control). Then copy the transcript to `D:\projects\bench-results\large\<arm>-run<N>\`.

**Also record:** added lines (`git diff --shortstat 801ee27..HEAD -- src bin test` in the run folder), spot-check score, DeepSeek turns per step (watch for steps hitting `maxTurns` 30), and whether any step's context had to be compacted.

**Success:** the question is whether delegated Claude output tokens fall below the Claude-only arm's, and by how much. Use the spread rule from the baseline: differences smaller than about 20% are noise.

| Run | Claude msgs | Claude output | Claude cache write | Claude cache read | DeepSeek input / cache read / output | DeepSeek turns | Est. DeepSeek cost | Fix rounds | Added lines | Spot check | Own tests | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bench-large-claude-run1 | 22 | 35,816 | 63,375 | 1,952,214 | n/a | n/a | n/a | n/a | 1,438 | 94/94 | 81/81 pass | 6.4 min |
| bench-large-claude-run2 | 19 | 33,271 | 62,365 | 1,657,772 | n/a | n/a | n/a | n/a | 1,460 | 94/94 | 76/76 pass | 5.7 min |
| **Claude-only average** | 21 | 34,544 | 62,870 | 1,804,993 | n/a | n/a | n/a | n/a | 1,449 | 94/94 | pass | 6.1 min |
| bench-large-0.2.1-run1 | 37 | 66,688 | 135,463 | 4,566,983 | 113,824 / 952,832 / 48,359 | 60 | 0.6526 CNY | 0 | 2,159 | 94/94 | 104/104 pass | 71 min |
| bench-large-0.2.1-run2 | 43 | 47,129 | 114,959 | 5,058,689 | 107,226 / 897,280 / 46,025 | 53 | 0.6185 CNY | 0 | 2,249 | 94/94 | 112/112 pass | 16 min |
| **Delegated average (0.2.1)** | 40 | 56,909 | 125,211 | 4,812,836 | 110,525 / 925,056 / 47,192 | 57 | 0.6356 CNY | 0 | 2,204 | 94/94 | pass | 16–71 min |
| bench-large-0.5.0-run1 | 45 | 36,086 | 99,087 | 5,027,209 | 109,346 / 824,576 / 52,758 | 51 | 0.6737 CNY | 0 | 2,196 | 94/94 | 103/103 pass | 10.3 min |

Wall time is first to last transcript entry, including time spent answering questions. Transcripts and `run.json` files are in `D:\projects\bench-results\large\claude-run1` and `claude-run2`.

**Claude-only results (2026-11-03).** Both runs made five commits, passed their own tests and scored 94/94 on the spot check. Two independent implementations matching every hand-derived expected value also confirms the checker. Run-to-run spread was small: output differed by 7%.

Both runs asked 4 questions, nearly the same set (the recommended option was picked each time; use the same answers in the delegated runs):
- Errors for len/push on the wrong type: type-error style messages.
- String escapes other than `\"`, `\\`, `\n`: an error at the backslash.
- User code can shadow built-ins (built-ins live in an outer scope); parameters share the function body's scope.
- Run 1 only: the right operand of `^` may be unary, so `2 ^ -1` is `2^(-1)`.
- Run 2 only: when a CLI run fails partway, lines already printed still go to stdout.

**Where Claude's output goes.** In both runs the files Claude wrote come to about 46,000 characters, roughly 13–15k tokens, so code is about 40% of Claude's output. Tool commands and reply text add about 2–3k tokens, and the rest (about 17–19k) is most likely thinking, which the transcript doesn't show in full. Compared with the small control (5,330 output tokens for about 130 lines), this task wrote 11× the lines for 6.5× the output tokens.

**What this means for the delegated runs.** Delegation can save at most the ~14k tokens of code plus the implementation part of the thinking. On 0.2.1 the planner re-types each step's full diff, about as many characters as the code itself, which may cancel most of that saving. If the 0.2.1 runs come out at or above ~35k output tokens, that doesn't show delegation can't pay off on large tasks. It shows that step 3g has to go first, and a 0.3.0 arm would settle it.

**Delegated run 1 results (2026-11-03).** Five steps, no fix rounds, 104/104 own tests and 94/94 on the spot check, so quality matched the Claude-only runs. DeepSeek wrote 2,159 lines, about 50% more than Claude did, mostly extra tests. Claude's output was 66,688 tokens, **1.9× the Claude-only average** (34,544): 13,134 before the run marker (planning) and 53,554 after it. Cache writes were 2.2× and cache reads 2.5×. The 71 minutes of wall time include answering 12 questions, 4 of them asked mid-run.

Where the output went, in characters from the transcript (thinking is not visible, so it is the remainder):

| Part | Characters | Rough tokens |
|---|---|---|
| Step 3g diff re-typing (5 reply blocks, 2,209 diff lines) | 60,700 | 17–19k |
| Specs written for DeepSeek (`step-01.md`–`step-05.md`) | 28,400 | 8–9k |
| Plan, questions (12), short replies, Skill and shell calls | about 35,000 | 9–10k |
| Thinking and other text (remainder) | n/a | about 30k |

DeepSeek: 60 turns over 5 coder runs, and step 2 took 24 of its 30 allowed turns. Estimated cost 0.65 CNY, about 4× the small baseline.

**Delegated run 2 results (2026-11-03).** Also five steps, no fix rounds, 112/112 own tests and 94/94 on the spot check. Claude's output was 47,129 tokens (11,312 planning, 35,817 after the run marker), 1.4× the Claude-only average and 29% below run 1. Wall time was 16 minutes, so most of run 1's 71 minutes was probably time waiting for answers. It again asked 12 questions (10 before the run, 2 during review), and the specs were about the same size (30,900 characters for 56,900 characters of code). DeepSeek took 53 turns, at most 14 in one step, for 0.62 CNY.

Most of the gap between the runs is step 3g. Run 2 re-typed the full diff for step 1 (11,300 characters), gave an abbreviated diff for step 2 (2,300 characters, with function bodies replaced by `...`), and for steps 3–5 only said "committed as `<hash>`". In all, its reply text during the run was 18,300 characters, against 64,700 in run 1. It still reviewed every step (read the diffs and test files, fuzzed the printer), so the review was not lighter. The planner follows step 3g inconsistently, so on 0.2.1 the run-to-run spread for large tasks (34% in Claude output) is larger than the baseline's 20%.

**Findings (both delegated runs):**
- On this ~1,450-line task, delegating on 0.2.1 cost the planner **1.65× the output tokens** of doing it in Claude (56.9k vs 34.5k), 2.0× the cache writes and 2.7× the cache reads, plus about 0.64 CNY of DeepSeek. Code quality was the same (94/94 in all four runs), and the delegated runs wrote more tests (104–112 vs 76–81). On the small task the ratio was 3×, so delegation's relative cost falls as the task grows, but it never broke even here.
- Re-typing diffs is the largest cost you can see, and it varies: about 18k tokens in run 1 and about 4k in run 2. PR 2 (`showDiff: stat`) removes it and should also remove most of the run-to-run spread.
- Without re-typed diffs, the two runs would be at about 48k and 43k: roughly 25–40% above Claude alone. What's left is mostly specs (about 9k tokens per run, half the size of the code they produce), plus planning and review thinking and 12 questions per run against 4. On a task this tightly specified, the spec is nearly the code.
- So PR 2 alone won't make delegation pay off on this task. That also needs shorter specs (point to the goal instead of restating it), fewer questions (only ones the goal really leaves open), and lighter review (no fuzzing the planner made up, which both runs did in step 4).
- Next: a 0.3.0 arm (2 runs) to measure PR 2 directly. A task with a short goal and a lot of code (such as "port this module" or "add CRUD endpoints for these 8 models"), where the spec can't be nearly the code, would test where delegation does pay off.

Transcripts and run folders: `D:\projects\bench-results\large\0.2.1-run1` and `0.2.1-run2`.

**Delegated run on 0.5.0 (2026-11-03).** One run with PRs 2–4 in, set up like the 0.2.1 runs. The only difference is a committed `.claude/settings.json` holding the two `run-check.js` allow rules. Five steps, no fix rounds, no compaction, 103/103 own tests and 94/94 on the spot check. Claude's output was 36,086 tokens (9,656 planning, 26,430 after the run marker). That is 37% below the 0.2.1 delegated average and 23% below the better 0.2.1 run, and only 4% above the Claude-only average (34,544), which is within noise. Cache writes fell to 99k (from 125k); cache reads stayed about the same (5.0M).

- Reply text after the run marker was 5,600 characters, against 64,700 and 18,300 in the 0.2.1 runs, so `showDiff: stat` removed the diff re-typing as intended.
- Specs were 24,900 characters for 60,200 characters of code, a little smaller than on 0.2.1 (28,400 and 30,900).
- 13 planner questions (4 before the run, 9 at the step specs), all answered with the recommended option.
- DeepSeek took 51 turns (at most 12 in one step) for 0.67 CNY, about the same as on 0.2.1.
- Wall time was 10.3 minutes.

It is a single run, and the large 0.2.1 runs spread by 34%, so read the 37% drop as likely real but not yet measured. Even so, on this tightly specified task delegation now breaks even with Claude alone on output tokens, where 0.2.1 cost 1.65× as much. The post-PR 6 benchmark (`reviewModel` unset arm, 2 runs) gives the proper measurement.

Transcript and run folder: `D:\projects\bench-results\large\0.5.0-run1`.

## PR 3: short test output, diff-only review and smaller fix rounds (0.4.0)

Decided 2026-11-03. Two of the 2026-10-28 review ideas land here: DeepSeek's own test runs count, and Claude reviews the diff instead of whole files. Both large delegated runs read the diffs and the test files and fuzzed the printer in step 4, so review is a real share of the planner's output on large tasks.

**How it's built:** branch `feat/run-check` from `main` (PR 2 is merged as #5). The first commit is this plan update. Then a delegation run on this repo in `plan` mode, and Claude verifies everything itself afterwards.

Step letters below match `commands/delegate.md` on `main`: 3d reads the result, 3e reviews, 3f runs fix rounds, 3g shows the changes.

**New `scripts/run-check.js --log <file> "<cmd>"`**
- Runs the command through a shell (`cmd.exe` on Windows, `sh` elsewhere) with `NO_COLOR=1` in its environment, and strips ANSI codes from everything it prints and logs.
- Appends to the log and never overwrites it. After the command finishes it writes a header, `=== <cmd> | <ISO time, UTC> | exit <N>, <secs>s ===`, followed by the full output.
- One log per spec, in the run folder: `step-NN-verify.log`, `step-NN-fixK-verify.log`, `final-verify.log`, `final-fixK-verify.log`. Several commands for one spec go into the same log.
- On pass, prints one line: `PASS <cmd> (exit 0, 8.2s)`.
- On fail, prints `FAIL <cmd> (exit <N>, <secs>s)`, the last 60 lines of output (fixed, no flag or config) and `Log: <path>`.
- Exits with the command's own exit code.
- Has no timeout of its own. `delegate.md` tells Claude to call it with the maximum tool timeout (600000 ms).
- Tests in `scripts/test/run-check.test.js` (node:test): the pass line, and on fail the tail, the log path and exit codes 0, 1 and 2 passed through; two runs appending to one log, each with its header; ANSI stripping in output and log, and `NO_COLOR=1` reaching the child; quoted arguments and `&&` going through the shell.

**Runner role prompts** (`deepseek-coder.ps1:36-42`, `deepseek-coder.sh:43-49`, same text in both): add "Before you finish, run every command in the spec's Verify with section, and end your report with one line per command: `VERIFY <cmd> -> exit <N>`."

**`commands/delegate.md`**
- Script table: a row for `run-check.js`, with the 600000 ms tool timeout.
- 3e, review (diff-only, with no exceptions and no per-step "deep review" flag):
  - In a git repo, read the step's step-diff `diff` and the names of the tests it added. Open a file, or part of one, only to settle a specific question the diff raises. Without a repo, read the files the coder reports changing, as today.
  - Don't write extra tests, fuzzers or scratch scripts. If coverage looks thin, say so in a fix spec and let DeepSeek add the tests.
- 3e, tests: Claude reads DeepSeek's `VERIFY` lines instead of running the tests.
  - Every verify command in the spec has a line with exit 0: accept, with no run.
  - Any line with a non-zero exit: write the fix spec straight away, without re-running anything.
  - A verify command with no line: run that command once through `run-check.js` (log `step-NN-verify.log`). On FAIL, write a fix spec.
  - "Run the spec's verify commands yourself" (`delegate.md:112`) and "run every verify command again" (`delegate.md:120`) are replaced by these rules. After a fix round the same rules apply to the fix's report.
- 3f, fix specs use a fixed template, and never restate the original spec (DeepSeek still has it in its resumed session):

  ```markdown
  # Step NN fix K
  ## Problems (file, line or function, expected vs actual)
  ## Changes needed
  ## Verify with
  ```
- 4, Finish, new first item, **final check:** run every distinct command from the step specs' "Verify with" sections once through `run-check.js` (log `final-verify.log`). If any fails, write `final-fixK.md` (same template, heading `# Final fix K`) and run it in a **new** coder session, not a resumed one, since it can span steps. Review it with step-diff `diff "<run folder>" final-fixK` and run the final check again. Each final fix is accepted as in 3h (its own commit in `commit` mode). After `maxFixRounds` failed final fixes, stop and ask the user, leaving the run marker in place. Usage tables, marker `stop` and the summary come after the final check passes.
- Known limitation, accepted: `step-diff stat` and `run` count a final fix's files as the last step's, because the last step's range runs to the working tree. Final fixes should be rare, so step-diff doesn't change.

**Config:** no new keys. `maxFixRounds` stays at 3 until usage data shows how often round 3 succeeds.

**Docs** (README, user guide, developer guide): two allow rules, `Bash(node *run-check.js*)` and `PowerShell(node *run-check.js*)` (PowerShell rules use the same shape as Bash rules, per the Claude Code permissions docs); the verify logs and their names; the `VERIFY` lines; diff-only review; the final check and final fixes; the fix-spec template. Bump `plugin.json` to 0.4.0.

**Measure:** no separate 0.3.0 arm (decided 2026-11-03). Measured after PR 6 on the large benchmark, as the order section says (the `reviewModel` unset arm), since diff-only review should matter most there. Watch fix rounds, final fixes and the spot-check score: lighter review and trusted test reports must not let bugs through.

## PR 4: size check before delegating (0.5.0)

Decided 2026-11-03. Built directly by Claude on branch `feat/size-check`, not as a delegation run: the change is small enough to fall under its own rule.

- **New config key `smallTaskPolicy`:** `ask` (default), `direct` or `delegate`, validated by `resolve-config.js`.
  - `ask`: Claude gives its estimate (about N changed lines in M files) and why it counts as small, then asks "Do it directly (Recommended)" or "Delegate to DeepSeek anyway".
  - `direct`: Claude says in one line that it will do the task directly, and does.
  - `delegate`: always delegate, as before.
- **What counts as small:** a guideline in `delegate.md`, not a config key: about 300 changed lines or fewer, in 6 files or fewer, tests included. That is well above the first idea (~30 lines in 1–2 files), because the control showed delegation costing 3× the Claude output on a ~130-line, 4-file task. The "no test-and-fix loop expected" condition was dropped. There is no post-PR 4 benchmark; revisit the number once there is usage data from real runs.
- **Where:** new Preflight item 2 in `delegate.md`, right after the existing-run check and before the config proposal, so a small task in a fresh project never triggers the config proposal or the pricing lookup, and the run marker doesn't exist yet. It applies to both `/deepseek-coder:delegate` and the skill.
- **Unclear size:** treat the task as not small and go on. Plan item 2 checks again once the steps are planned, and before the run folder exists tells the user and applies the policy. If the user already picked "delegate" in Preflight, it doesn't ask again.
- **Doing it directly** (new section "Small tasks done directly" in `delegate.md`): Claude follows the planning skill's sections 1–2 (confirm facts, ask every open question), shows a numbered step list and continues without waiting, edits the files itself, and runs the tests through `run-check.js` with a log in the system temp directory. No run folder, `plan.md`, specs, marker, usage tables, commit or staging; the summary says the changes are uncommitted.
- **Skill description** (`skills/deepseek-delegation/SKILL.md:3`): not narrowed (decision 4).
- **Docs:** both config tables and example configs, README "What happens in a run" item 1, a user-guide `smallTaskPolicy` paragraph under "Choosing settings", a note in the first-run walkthrough, a new FAQ entry "Why did Claude do my task itself?", and a sentence in the skill FAQ entry.

## PR 5: model names and the planner model

- Run a one-line test spec with `deepseek-flash[1m]`, `deepseek-flash` and `deepseek-v4-flash`. It costs a few cents of DeepSeek usage; ask first.
- Change the default `model` only if the test shows a difference.
- Document that planning and review run on the user's session model, and that Sonnet is the cheaper choice for the planner.

## PR 6: optional smaller review model (proposed 2026-11-03)

The third 2026-10-28 review idea. Not decided. Its effect is told apart from PRs 2–4 by the two arms of the post-PR 6 large benchmark.

- **New config key `reviewModel`:** unset by default (Claude reviews, as today). When set (for example `haiku`), step 3d hands the review to a subagent on that model.
- **What the reviewer gets:** the step's `git diff`, the step spec and the `run-check.js` line. Not the goal, the plan or earlier steps.
- **What it returns:** `OK`, or a short list of concerns, each naming a file and line. Claude reads only that verdict, and on concerns writes a fix spec (PR 3's 3f rules apply).
- **Guard:** Claude still runs `run-check.js` itself, so a passing review never stands in for passing tests.
- **Risk:** a weaker reviewer misses bugs that show up later as fix rounds or spot-check failures. Make it a default only if fix rounds and spot-check scores hold.
- **Measure:** the `reviewModel` set arm of the post-PR 6 large benchmark (×2), against the `reviewModel` unset arm. Compare Claude output tokens, the reviewer model's tokens (priced separately), fix rounds and spot-check score.
- **Docs:** the config tables, and a note in the user guide on the trade-off.

## Lessons from PRs 1 and 2

- `usage` in a coder log covers one whole coder run. `modelUsage` and `total_cost_usd` add up across `--resume` and use Claude prices, so never read them.
- Cache reads are most of DeepSeek's input, so cost estimates price them separately.
- Session transcripts write each assistant message several times. Count each `message.id` once.
- The run marker is deleted before the summary, so run data that the summary needs lives in `run.json` in the run folder.
- DeepSeek can only run `allowedCommands` (`node --test` here). Claude tests anything that needs a shell, such as the runner scripts, itself.
- An exclude pathspec that names a gitignored path (`git add -A -- . ":(exclude).deepseek-coder"`) makes `git add` exit 1, even though it stages everything else. With `.deepseek-coder/` gitignored, 0.3.0 snapshots failed silently and the accept command stopped before the commit. Fixed in PR 3 (step 05): add everything, then drop the plugin path with `git rm -r -q -f --cached --ignore-unmatch`. Failed snapshots now print a warning on stderr, so a failure like this can't go unnoticed again.

## Open questions

1. **PR 5 version:** bump only if defaults or code change, or always?
2. **PR 4 size threshold:** settled 2026-11-03 at about 300 changed lines in 6 files or fewer. There is no post-PR 4 benchmark; check it against usage data from real runs.
3. **PR 6 reviewer:** which model, and should a subagent's tokens count toward the Claude-side numbers in `usage.js claude`?
