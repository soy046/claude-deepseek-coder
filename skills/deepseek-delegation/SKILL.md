---
name: deepseek-delegation
description: Delegate implementation work to DeepSeek with Claude as planner and reviewer (deepseek-coder plugin). Use when the user asks to implement, build, add, fix or refactor code in a project, or asks to hand coding to DeepSeek. Not for questions, explanations or reviews that change no code.
---

# Delegate implementation to DeepSeek

If the environment variable `DEEPSEEK_CODER_ACTIVE` is `1`, you are the DeepSeek coder: do not use this skill.

Otherwise, read `${CLAUDE_PLUGIN_ROOT}/commands/delegate.md` and follow it exactly, with the user's request as the Goal.
Wherever that file contains the plugin root placeholder, use this path: `${CLAUDE_PLUGIN_ROOT}`.

The same project config applies as for `/deepseek-coder:delegate`, including its `approvalMode` and `gitMode`.
