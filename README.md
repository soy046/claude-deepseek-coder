# deepseek-coder

**New here?** Start with the [user guide](docs/USER_GUIDE.md): it walks you through installing, setting your API key, and your first run.

**Working on the plugin itself?** See the [developer guide](docs/DEVELOPER_GUIDE.md) for the code layout, the run folder files and how to run the tests.

A Claude Code plugin that splits work between two models:

- **Claude (your normal session) is the planner.** It explores the code, breaks the goal into steps, writes a spec for each step, reviews the result and runs the tests.
- **DeepSeek is the coder.** Each spec runs in a separate headless Claude Code process (`claude -p`) whose API calls go to DeepSeek's Anthropic-compatible endpoint. That process reads and edits files and runs the commands you allow.

```
You -> /deepseek-coder:delegate <goal>
        Claude: plan -> step-01.md -> [DeepSeek writes code] -> review diff + tests -> fix spec? -> commit
                        step-02.md -> ...
```

## Requirements

- Claude Code
- Node.js (used by the hook and the helper scripts)
- Git (optional; see `gitMode`)
- A DeepSeek API key
- Windows: Windows PowerShell 5.1 (built in). macOS/Linux: bash.

## Install

```
/plugin marketplace add soy046/claude-deepseek-coder
/plugin install deepseek-coder@soy046
```

Set your API key as an environment variable, then restart Claude Code so it sees it.

Windows (PowerShell):

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "<your key>", "User")
```

macOS/Linux (add to `~/.zshrc` or `~/.bashrc`):

```bash
export DEEPSEEK_API_KEY="<your key>"
```

Never put the key in the project config or commit it.

During a run Claude runs tests through the plugin's `run-check.js`, which prints one line when they pass. So that Claude Code doesn't ask each time, add these allow rules to `~/.claude/settings.json` (all projects) or your project's `.claude/settings.json`. The first covers the Bash tool, the second the PowerShell tool on Windows:

```json
{
  "permissions": {
    "allow": ["Bash(node *run-check.js*)", "PowerShell(node *run-check.js*)"]
  }
}
```

## Use

```
/deepseek-coder:delegate add a /health endpoint with a test
```

The plugin also has a skill, so Claude may start the same workflow on its own when you ask it to implement something. It follows the same config.

The first time you use it in a project, Claude proposes a `.deepseek-coder/config.json` and writes it only after you approve it.

## Configuration: `.deepseek-coder/config.json`

```json
{
  "allowedCommands": ["npm test", "npm run lint"],
  "model": "deepseek-flash[1m]",
  "maxTurns": 60,
  "extraInstructions": "",
  "approvalMode": "step",
  "gitMode": "commit",
  "maxFixRounds": 3,
  "markerExpiryMinutes": 30,
  "deepseekPricing": null,
  "showDiff": "stat",
  "smallTaskPolicy": "ask"
}
```

| Key | Values | Default | Meaning |
|---|---|---|---|
| `allowedCommands` | array of strings | `[]` | The only shell commands DeepSeek may run. Prefix match: `"npm test"` also allows `npm test -- --watch=false`. |
| `model` | DeepSeek model name | `deepseek-flash[1m]` | Model the coder uses. |
| `maxTurns` | positive integer | `60` | Upper limit on DeepSeek replies per coder run; one reply can make several tool calls. Claude gives each run its own limit from the size of its spec: about 1 turn per 12 changed lines, at least 10, capped at this value. |
| `extraInstructions` | string | `""` | Project rules appended to the coder's system prompt. |
| `approvalMode` | `step` / `plan` / `auto` | `step` | `step`: you review and approve every spec, fix specs included, before DeepSeek gets it. `plan`: you approve the step list once. `auto`: no stops. |
| `gitMode` | `commit` / `stage` / `none` | `commit` | What happens after an accepted step: a Conventional Commit, `git add -A`, or nothing. |
| `maxFixRounds` | positive integer | `3` | Correction attempts per step before Claude stops and asks you. |
| `markerExpiryMinutes` | positive integer | `30` | Minutes of inactivity after which a leftover run marker is ignored. |
| `deepseekPricing` | `null` or `{"input", "cacheHit", "output", "currency"}` | `null` | DeepSeek prices per 1M tokens (input on a cache miss, input on a cache hit, output) and a 3-letter currency code such as `USD`. When set, the coder output and the usage table show an estimated cost. While it is `null`, Claude asks for it at the start of each run. |
| `showDiff` | `stat` / `full` | `stat` | `stat`: after each step Claude shows the changed files with `+/-` counts, and the full diff only when you ask. `full`: it also shows the full diff every time. |
| `smallTaskPolicy` | `ask` / `direct` / `delegate` | `ask` | What Claude does when a task looks small: about 300 changed lines or fewer, in 6 files or fewer. `ask`: it asks whether to do the task itself or delegate it. `direct`: it does the task itself and tells you so. `delegate`: it always delegates. |

Precedence for `model` and `maxTurns`: config file, then the `DEEPSEEK_MODEL` / `DEEPSEEK_MAX_TURNS` environment variables, then the defaults above. Other keys come from the config file or the defaults.

Whether to commit this file is up to each project; the plugin does not touch `.gitignore`.

The config and the run folders live in `.deepseek-coder/` rather than `.claude/` because Claude Code asks for permission on every write inside `.claude/`, even with allow rules, which would interrupt every run.

## What happens in a run

1. **Preflight.** Claude checks for a leftover run, creates the config if missing, and checks git. If `deepseekPricing` isn't set, it asks which currency to use (or whether to skip this run), looks up DeepSeek's prices, asks you for any it couldn't find, and saves them only after you confirm. In a folder that isn't a git repo, it asks whether you want git and offers `git init`; if you say no, it saves `"gitMode": "none"`. Before all that, unless `smallTaskPolicy` is `delegate`, Claude checks whether the task looks small: about 300 changed lines or fewer, in 6 files or fewer. If it does, Claude asks whether to do it directly (`ask`, the default) or just does so (`direct`). It then plans and asks its questions as usual, edits the files itself and runs the tests through `run-check.js`, with no run folder and no commit. If the size is unclear, the run goes on, and Claude checks again once the steps are planned.
2. **Plan.** Claude looks up what the code can answer and shows it to you to confirm. It asks you about every choice the goal leaves open (behaviour, names, interfaces, edge cases, tests, scope) and doesn't fill gaps on its own. Then it splits the goal into steps and creates a run folder `.deepseek-coder/plans/<date-time>-<slug>/` with a `plan.md` that records your answers. The rules are in `skills/claude-planning/SKILL.md`.
3. **Each step.** Claude writes the step's interface stubs (exact signatures, with bodies that throw `not implemented`), then `step-NN.md`, which points to them. DeepSeek fills in the bodies and writes the tests. A step that plans to edit a file the previous step also planned to edit continues that step's DeepSeek session; otherwise it starts a new one. With the default `approvalMode` of `step`, Claude shows you the full spec and waits for your approval. It then runs the coder in the background and reviews the step's diff from a snapshot of the working tree taken just before the coder started (without a git repo: the changed files). It reads the diff rather than whole files, and writes no extra tests or scripts of its own. For tests it reads the `VERIFY <cmd> -> exit <N>` lines DeepSeek ends its report with, and runs a command itself, through `run-check.js`, only when its line is missing. If something is wrong it writes `step-NN-fixK.md`, which lists only the problems and the changes needed, has you review it too in `step` mode, and resumes the same DeepSeek session; after a fix round it reads only what the fix changed. After `maxFixRounds` failed fixes it stops and asks you.
4. **Show the changes.** Before accepting a step, Claude shows you the files DeepSeek changed (status and `+/-` line counts), leaving out the plugin's own `.deepseek-coder/` files. With the default `showDiff` of `stat` it shows the full diff only when you ask for it; with `full` it shows it every time. Without a git repo it lists the changed files only.
5. **Accept.** Depending on `gitMode`, Claude commits (Conventional Commits with `Co-Authored-By` trailers for Claude and the DeepSeek model), stages, or does nothing.
6. **Finish.** Claude runs every step's verify commands once more through `run-check.js` as a final check. If one fails, it writes `final-fixK.md` and runs it in a new DeepSeek session, up to `maxFixRounds` times. Then Claude summarizes the run, including a combined list of every file changed and which steps touched it, a table of DeepSeek's tokens for each coder run (with an estimated cost when `deepseekPricing` is set), and a best-effort table of Claude's own tokens from the session transcript. In `commit` mode with a remote, it asks whether to push; it never pushes on its own.

Every spec, the coder's raw JSON output (`step-NN.json`), the usage records (`usage.jsonl`), the full test output (`*-verify.log`), the run's start time and transcript path (`run.json`) and the snapshot hashes (`.snap-*`) are kept in the run folder. Add `.deepseek-coder/plans/` to `.gitignore` if you don't want them committed.

## Safety

- **Edit guard.** While a run is active, a hook blocks Claude from editing anything except the run folder, the config file, and the stub files Claude registers for the run with `run-marker.js allow`. All other source changes must go through DeepSeek.
- **Recursion guard.** The coder process can't start another delegation: the wrapper refuses to run inside a coder (`DEEPSEEK_CODER_ACTIVE=1`), and the coder is denied shell launchers, the Skill tool and subagents.
- **Coder permissions.** The coder may use Read, Edit, Write, Glob, Grep and your `allowedCommands` only. No web access, no MCP servers, no `git push`.
- **Leftover marker.** If a run crashes, the marker expires after `markerExpiryMinutes` of inactivity, or you can clear it with `/deepseek-coder:reset`.
- **Snapshots.** Before each coder run, the plugin snapshots the working tree as a git tree through a private index. Your real index, HEAD, branches and stash are never touched; the snapshots are unreferenced and `git gc` removes them eventually. Gitignored files are not captured.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DEEPSEEK_API_KEY is not set` | Set the variable (see Install) and restart Claude Code. |
| `401` / authentication error in the coder log | The key is wrong or expired. Check it in the DeepSeek console. |
| `no .deepseek-coder/config.json in this project` | Run `/deepseek-coder:delegate`; Claude will propose the config. |
| `config error: ...` | Fix the named key in `.deepseek-coder/config.json`. |
| Claude can't edit a file: "a delegation run is active" | Expected during a run. If no run is active, run `/deepseek-coder:reset`. |
| Coder `STATUS: error_max_turns` | If the step's diff is complete, Claude reviews and accepts it as normal. Otherwise the step was too big for its turn limit: raise `maxTurns` (the cap) or ask Claude to split the step. |
| Coder says a command was denied | Add it to `allowedCommands`. |
| Claude Code asks permission every time Claude runs `run-check.js` | Add the two allow rules from Install. |
| "running scripts is disabled on this system" (Windows) | The command uses `-ExecutionPolicy Bypass`; make sure it wasn't removed. |
| Non-English text garbled | Save spec files as UTF-8 (the wrapper reads and writes UTF-8). |
| Cost in the JSON log looks wrong | `total_cost_usd` and `modelUsage` in the log use Claude prices and add up across fix rounds. Use the coder's `USAGE` line or, from the project root, `node "<plugin folder>/scripts/usage.js" <run folder>` instead. |
| Claude usage table says "no run.json" or "no transcript path recorded" | The run was started by a plugin version before 0.2.1, or Claude never wrote a file into the run folder. The DeepSeek table still works. |
| Images or PDFs not understood by the coder | DeepSeek's Anthropic-compatible endpoint doesn't support document content. Describe it in the spec. |
