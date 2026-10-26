# deepseek-coder

**New here?** Start with the [user guide](docs/USER_GUIDE.md): it walks you through installing, setting your API key, and your first run.

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
  "maxTurns": 20,
  "extraInstructions": "",
  "approvalMode": "plan",
  "gitMode": "commit",
  "maxFixRounds": 3,
  "markerExpiryMinutes": 30
}
```

| Key | Values | Default | Meaning |
|---|---|---|---|
| `allowedCommands` | array of strings | `[]` | The only shell commands DeepSeek may run. Prefix match: `"npm test"` also allows `npm test -- --watch=false`. |
| `model` | DeepSeek model name | `deepseek-flash[1m]` | Model the coder uses. |
| `maxTurns` | positive integer | `20` | Turn limit per coder run. |
| `extraInstructions` | string | `""` | Project rules appended to the coder's system prompt. |
| `approvalMode` | `plan` / `step` / `auto` | `plan` | `plan`: you approve the step list once. `step`: you approve every spec. `auto`: no stops. |
| `gitMode` | `commit` / `stage` / `none` | `commit` | What happens after an accepted step: a Conventional Commit, `git add -A`, or nothing. |
| `maxFixRounds` | positive integer | `3` | Correction attempts per step before Claude stops and asks you. |
| `markerExpiryMinutes` | positive integer | `30` | Minutes of inactivity after which a leftover run marker is ignored. |

Precedence for `model` and `maxTurns`: config file, then the `DEEPSEEK_MODEL` / `DEEPSEEK_MAX_TURNS` environment variables, then the defaults above. Other keys come from the config file or the defaults.

Whether to commit this file is up to each project; the plugin does not touch `.gitignore`.

The config and the run folders live in `.deepseek-coder/` rather than `.claude/` because Claude Code asks for permission on every write inside `.claude/`, even with allow rules, which would interrupt every run.

## What happens in a run

1. **Preflight.** Claude checks for a leftover run, creates the config if missing, and checks git. In a folder that isn't a git repo, it asks whether you want git and offers `git init`; if you say no, it saves `"gitMode": "none"`.
2. **Plan.** Claude splits the goal into steps and creates a run folder `.deepseek-coder/plans/<date-time>-<slug>/`.
3. **Each step.** Claude writes `step-NN.md`, runs the coder in the background, reviews the diff (or the changed files with `gitMode: none`) and runs the tests itself. If something is wrong it writes `step-NN-fixK.md` and resumes the same DeepSeek session. After `maxFixRounds` failed fixes it stops and asks you.
4. **Show the changes.** Before accepting a step, Claude shows you the files DeepSeek changed (status and `+/-` line counts) and the full diff in the conversation, leaving out the plugin's own `.deepseek-coder/` files. With `gitMode: none` it lists the changed files only.
5. **Accept.** Depending on `gitMode`, Claude commits (Conventional Commits with `Co-Authored-By` trailers for Claude and the DeepSeek model), stages, or does nothing.
6. **Finish.** Claude summarizes the run, including a combined list of every file changed and which steps touched it. In `commit` mode with a remote, it asks whether to push; it never pushes on its own.

Every spec and the coder's raw JSON output (`step-NN.json`) are kept in the run folder. Add `.deepseek-coder/plans/` to `.gitignore` if you don't want them committed.

## Safety

- **Edit guard.** While a run is active, a hook blocks Claude from editing anything except the run folder and the config file. Source changes must go through DeepSeek.
- **Recursion guard.** The coder process can't start another delegation: the wrapper refuses to run inside a coder (`DEEPSEEK_CODER_ACTIVE=1`), and the coder is denied shell launchers, the Skill tool and subagents.
- **Coder permissions.** The coder may use Read, Edit, Write, Glob, Grep and your `allowedCommands` only. No web access, no MCP servers, no `git push`.
- **Leftover marker.** If a run crashes, the marker expires after `markerExpiryMinutes` of inactivity, or you can clear it with `/deepseek-coder:reset`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DEEPSEEK_API_KEY is not set` | Set the variable (see Install) and restart Claude Code. |
| `401` / authentication error in the coder log | The key is wrong or expired. Check it in the DeepSeek console. |
| `no .deepseek-coder/config.json in this project` | Run `/deepseek-coder:delegate`; Claude will propose the config. |
| `config error: ...` | Fix the named key in `.deepseek-coder/config.json`. |
| Claude can't edit a file: "a delegation run is active" | Expected during a run. If no run is active, run `/deepseek-coder:reset`. |
| Coder `STATUS: error_max_turns` | The step was too big. Raise `maxTurns` or ask Claude to split the step. |
| Coder says a command was denied | Add it to `allowedCommands`. |
| "running scripts is disabled on this system" (Windows) | The command uses `-ExecutionPolicy Bypass`; make sure it wasn't removed. |
| Non-English text garbled | Save spec files as UTF-8 (the wrapper reads and writes UTF-8). |
| Cost in the JSON log looks wrong | `total_cost_usd` is computed at Claude prices. Check the DeepSeek console for real usage. |
| Images or PDFs not understood by the coder | DeepSeek's Anthropic-compatible endpoint doesn't support document content. Describe it in the spec. |
