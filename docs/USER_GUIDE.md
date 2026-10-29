# deepseek-coder user guide

This guide is for anyone who has just installed the deepseek-coder plugin and wants to use it for the first time. It shows what the plugin does, how to set it up, what happens during a run, and how to choose the settings that fit your project. You do not need to know how Claude Code plugins work to follow it.

**Contents**

- [What it does](#what-it-does)
- [Before you start](#before-you-start)
- [Install](#install)
- [Set your API key](#set-your-api-key)
- [Your first run](#your-first-run)
- [Choosing settings](#choosing-settings)
- [Writing good goals](#writing-good-goals)
- [Fix rounds: when Claude stops to ask you](#fix-rounds-when-claude-stops-to-ask-you)
- [Safety in plain words](#safety-in-plain-words)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)

## What it does

The plugin splits the work between two models. Claude, in your normal session, plans and reviews: it explores the code, breaks your goal into steps, writes a spec for each step, reviews the result and runs the tests. DeepSeek writes the code: each spec runs in a separate headless Claude Code process (`claude -p`) whose API calls go to DeepSeek's Anthropic-compatible endpoint, and that process reads and edits files and runs the commands you allow.

```
You -> /deepseek-coder:delegate <goal>
        Claude: plan -> step-01.md -> [DeepSeek writes code] -> review diff + tests -> fix spec? -> commit
                        step-02.md -> ...
```

Because Claude never edits source files during a run, you get a second pair of eyes on every change before it is accepted. Every spec, and the coder's raw JSON output (`step-NN.json`), is kept in the run folder so you can look back at exactly what was asked and what came back.

## Before you start

You need:

- **Claude Code.** The plugin runs inside it.
- **Node.js.** The hook and the helper scripts are written in Node.js.
- **Git (optional).** Only needed for `gitMode` set to `commit` or `stage`. In a folder that isn't a git repo, Claude asks whether you want git and offers `git init`.
- **A DeepSeek account and API key.** DeepSeek does the coding, so you need a key from DeepSeek.
- **Windows: Windows PowerShell 5.1** (built into Windows). **macOS/Linux: bash.**

## Install

Run these two commands in Claude Code:

```
/plugin marketplace add soy046/claude-deepseek-coder
/plugin install deepseek-coder@soy046
```

After installing the plugin or setting the key, fully quit the Claude desktop app and reopen it. Clicking the close button only closes the window; the app keeps running. Right-click the Claude icon in the system tray, choose **Quit**, then start it again. Only a fresh start picks up the plugin and new environment variables.

## Set your API key

Set the key as an environment variable, then restart Claude Code so it sees it.

Windows (PowerShell):

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "<your key>", "User")
```

macOS/Linux (add this line to `~/.zshrc` or `~/.bashrc`):

```bash
export DEEPSEEK_API_KEY="<your key>"
```

Never put the key in the project config or commit it. The plugin passes it to the coder process through the environment only, and never writes it into a file or a command.

## Your first run

Here is a real run, start to finish. The goal was:

```
add a subtract(a, b) function to src/math.js with a test
```

**1. You type the command.** From your project folder, in Claude Code:

```
/deepseek-coder:delegate add a subtract(a, b) function to src/math.js with a test
```

**2. Claude proposes a config.** The first time you use the plugin in a project, there is no `.deepseek-coder/config.json`. Claude inspects the project to find its test, lint and build commands, then shows you a complete config — every key, with `allowedCommands` filled in from what it found. It writes the file only after you approve it, with any changes you ask for.

**3. Claude asks its questions and plans.** Claude explores the code. It shows you what it found there, such as where `src/math.js` exports its functions and which command runs the tests, and asks you to confirm. Then it asks about every choice the goal leaves open instead of guessing. In this example, that could be whether `subtract` should check its arguments' types and which test cases to add. If an answer is vague, Claude offers concrete options and asks again. When nothing is open, it splits the goal into small ordered steps, creates a run folder at `.deepseek-coder/plans/<date-time>-<slug>/`, and records your answers in `plan.md` there. It shows you the numbered step list. In this example the plan had one step.

**4. You review the spec.** Claude writes `step-01.md` in the run folder and, with the default `approvalMode` of `step`, shows you the whole spec in the conversation. If you ask for changes, it updates the spec and shows it again. Nothing goes to DeepSeek until you approve that version.

**5. DeepSeek works in the background.** Claude starts the coder in the background. The coder is a separate headless Claude Code process; its output goes to `step-01.json` next to the spec. Claude waits for it to finish and does not edit files meanwhile. In this run DeepSeek took 7 turns and needed no fix rounds.

**6. Claude shows what changed.** DeepSeek's own report is never trusted on its own: Claude reads the diff and runs the tests itself. Once the step passes review, Claude shows you the change in the conversation. That is a small list of files with their status letters and line counts:

```
Step 01 changed 2 files:
  M src/math.js         +4 -1
  M test/math.test.js   +5 -1
```

Below the list, Claude shows the full diff in a `diff` code block, without trimming it. The important part of this one was:

```diff
+function subtract(a, b) {
+  return a - b;
+}
-module.exports = { add, multiply };
+module.exports = { add, multiply, subtract };
```

The plugin's own files in `.deepseek-coder/` are left out of both the list and the diff.

**7. The step is committed.** With the default `gitMode` of `commit`, Claude commits. The message is a Conventional Commit and ends with one trailer for Claude and one for the DeepSeek model that wrote the code:

```
feat(math): add subtract

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: DeepSeek deepseek-flash[1m] <noreply@deepseek.com>
```

**8. Claude summarizes the run.** You get each step, what DeepSeek implemented, which fix rounds were needed and why, the final test results, and the run folder path. The summary also includes a combined list of every file changed in the run, with the steps that touched it:

```
Files changed in this run:
  M src/math.js         +4 -1   (step 01)
  M test/math.test.js   +5 -1   (step 01)
```

**9. Claude asks about pushing.** In `commit` mode, if the repository has a remote, Claude asks whether to push. It never pushes on its own.

That's a whole run. Most of the time, your job is to answer Claude's questions, approve each spec, and read the changes as each step comes in.

## Choosing settings

Settings live in `.deepseek-coder/config.json` in your project. Here is an example:

```json
{
  "allowedCommands": ["npm test", "npm run lint"],
  "model": "deepseek-flash[1m]",
  "maxTurns": 20,
  "extraInstructions": "",
  "approvalMode": "step",
  "gitMode": "commit",
  "maxFixRounds": 3,
  "markerExpiryMinutes": 30
}
```

These are all the keys:

| Key | Values | Default | Meaning |
|---|---|---|---|
| `allowedCommands` | array of strings | `[]` | The only shell commands DeepSeek may run. Prefix match: `"npm test"` also allows `npm test -- --watch=false`. |
| `model` | DeepSeek model name | `deepseek-flash[1m]` | Model the coder uses. |
| `maxTurns` | positive integer | `20` | Turn limit per coder run. |
| `extraInstructions` | string | `""` | Project rules appended to the coder's system prompt. |
| `approvalMode` | `step` / `plan` / `auto` | `step` | `step`: you review and approve every spec, fix specs included, before DeepSeek gets it. `plan`: you approve the step list once. `auto`: no stops. |
| `gitMode` | `commit` / `stage` / `none` | `commit` | What happens after an accepted step: a Conventional Commit, `git add -A`, or nothing. |
| `maxFixRounds` | positive integer | `3` | Correction attempts per step before Claude stops and asks you. |
| `markerExpiryMinutes` | positive integer | `30` | Minutes of inactivity after which a leftover run marker is ignored. |

When Claude proposes the config, it fills in `allowedCommands` from the project's test, lint and build commands; you can add or remove entries before approving. If the key is left out, the default is `[]`, and DeepSeek can then run no shell commands. Use `extraInstructions` for project rules the coder should always follow, such as a style guide or libraries to avoid; those rules are appended to its system prompt.

**`approvalMode`.** Use `step` (the default) when you want to read and approve every spec before DeepSeek sees it, including the fix specs Claude writes when a step needs corrections. Use `plan` when you want to check the step list once and then let the run go. Use `auto` only when you trust the goal and the project knows how to test itself, because there are no stops at all.

**`gitMode`.** Use `commit` (the default) to get one Conventional Commit per accepted step. Use `stage` if you want to review and commit the changes yourself; Claude runs `git add -A` and stops there. Use `none` for a folder that isn't a git repository; DeepSeek's changes are not committed or staged.

**`allowedCommands`.** These are the only shell commands DeepSeek may run. Entries are prefix matches, so `"npm test"` also allows `npm test -- --watch=false`, but not `npm run test`. Use commands that match your project:

| Project type | Example entry | What it allows |
|---|---|---|
| Node.js | `"npm test"` | `npm test`, `npm test -- --watch=false` |
| Node.js | `"npm run lint"` | `npm run lint`, `npm run lint -- --fix` |
| Python | `"pytest"` | `pytest`, `pytest tests/test_math.py` |
| Rust | `"cargo test"` | `cargo test`, `cargo test --lib` |
| Go | `"go test"` | `go test`, `go test ./...` |

Anything not covered by an entry is denied, and DeepSeek reports the denied command instead of running it.

**Precedence.** For `model` and `maxTurns`, the config file wins, then the `DEEPSEEK_MODEL` / `DEEPSEEK_MAX_TURNS` environment variables, then the defaults above. Other keys come from the config file or the defaults.

## Writing good goals

Claude turns your goal into a plan and a spec for each step, so a clear goal gives Claude a better plan. A few tips:

1. **Ask for one clear outcome.** "Add a subtract function" is a goal; "modernize the math module and fix the build" is several goals at once.
2. **Name files and functions.** Say where the code should live and what it should be called, so Claude and DeepSeek don't have to guess.
3. **Say the expected behaviour and edge cases.** Include inputs, return values and what should happen with unusual values.
4. **Mention how to test it.** Point at the test file you want, using commands that are in `allowedCommands`.
5. **Keep goals small.** A goal that fits in a few steps is easier to review and less likely to hit the `maxTurns` limit.

A weak goal:

```
add subtract to the math stuff
```

A strong goal:

```
Add a subtract(a, b) function to src/math.js that returns a - b, export it from
module.exports, and add a test in test/math.test.js covering positive and negative
numbers. Verify with npm test.
```

## Fix rounds: when Claude stops to ask you

After DeepSeek finishes a step, Claude reviews the result. If something fails, Claude writes a fix spec, `step-NN-fixK.md`, that lists each problem concretely — file, line or function, expected versus actual — and resumes the same DeepSeek session with it. That attempt is a **fix round**.

`maxFixRounds` (default `3`) limits how many correction attempts a step gets. After the last failed fix round, Claude stops, shows you what failed — the spec, the latest DeepSeek report and the failing checks — and asks you what to do. The run marker stays in place while you decide. If you tell Claude to edit the code itself, it ends the run first so the edit guard lets it through.

## Safety in plain words

**The edit guard.** While a run is active, a hook blocks Claude from editing anything except the run folder (`.deepseek-coder/plans/`) and the config file (`.deepseek-coder/config.json`). Source changes have to go through DeepSeek. If a crash leaves a marker behind, it is ignored after `markerExpiryMinutes` of inactivity, or you can clear it with `/deepseek-coder:reset`.

**The recursion guard.** The coder can't start another delegation. The wrapper refuses to run inside a coder (`DEEPSEEK_CODER_ACTIVE=1`), and the coder is denied shell launchers, the Skill tool and subagents.

**What DeepSeek may and may not do.** The coder may use Read, Edit, Write, Glob, Grep and your `allowedCommands` only. It has no web access, no MCP servers, and it cannot `git push`. If it needs a command you didn't allow, it says so in its report rather than running it.

**Leftover run markers.** If a run crashes, a marker in `.deepseek-coder/plans/` can make Claude look like it is still in a run. It expires after `markerExpiryMinutes` of inactivity, or you can run `/deepseek-coder:reset` to clear it. The reset command tells you that the unfinished run's spec files are still in `.deepseek-coder/plans/`; it does not delete them.

Claude also follows some rules of its own during a run: it never deletes run folders or spec files, and it never writes the API key into a file or a command.

## FAQ

**What does it cost?**

DeepSeek bills your DeepSeek account. Claude usage is only planning and review. The `total_cost_usd` figure in the JSON log is computed at Claude prices, so it is not your DeepSeek cost — check the DeepSeek console for that.

**How do I change the DeepSeek model?**

Set `model` in `.deepseek-coder/config.json` (this wins), or set the `DEEPSEEK_MODEL` environment variable. `deepseek-flash` and `deepseek-v4-pro` exist. A `[1m]` after a model name, as in `deepseek-flash[1m]`, means the 1M-token context version. The default is `deepseek-flash[1m]`.

**Should I commit `.deepseek-coder/`?**

That's up to you; the plugin never edits `.gitignore`. If you don't want specs and logs in your repository, add `.deepseek-coder/` — or just `.deepseek-coder/plans/` — to `.gitignore`. The run marker is never committed.

**Why `.deepseek-coder/` and not `.claude/`?**

Claude Code asks for permission on every write inside `.claude/`, even with allow rules, which would interrupt every run. Keeping the config and run folders in `.deepseek-coder/` avoids that.

**Can Claude start a run without the slash command?**

Yes. The plugin includes a skill, so when you ask Claude to implement, build, add to, fix or refactor code, it may start the same workflow on its own. It follows the same config and the same run steps as `/deepseek-coder:delegate`.

**What if my project isn't a git repository?**

Claude asks whether you want to work with git and offers `git init`. If you say no, it saves `"gitMode": "none"` in `.deepseek-coder/config.json` and continues without git.

## Troubleshooting

If something goes wrong — a missing API key, a config error, a coder that hits its turn limit, or a command DeepSeek was denied — see the Troubleshooting table in the [README](../README.md#troubleshooting). It lists the common messages and the fix for each.
