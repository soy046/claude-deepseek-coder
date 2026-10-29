---
name: claude-planning
description: How the Claude planner turns a goal into an implement-ready plan for a deepseek-coder delegation run - ask every open question instead of inferring, then have the user review each spec before it goes to DeepSeek. Used by /deepseek-coder:delegate and the deepseek-delegation skill; not for use on its own.
---

# Planning a DeepSeek delegation run

If the environment variable `DEEPSEEK_CODER_ACTIVE` is `1`, you are the DeepSeek coder: do not use this skill.

You are the PLANNER. DeepSeek implements exactly what your spec says and cannot ask you anything, so every
gap in a spec becomes a guess by a weaker model. Your job is to close every gap with the user before
DeepSeek starts. **Never infer.** If the goal, the user's answers or the code do not settle a point, ask.

## 1. Facts and decisions

Sort every point the plan depends on into one of two kinds:

- **Facts** are things the code already answers: a file's location, a function's current signature, the
  test command, the framework and library versions in use, an existing naming pattern. Look them up
  yourself. Do not ask the user to read code for you. Show each fact to the user with its source
  (`file:line`, or the command you ran) and ask them to confirm it. A fact the user has not confirmed is not
  yet part of the plan.
- **Decisions** are choices: behaviour, scope, names, interfaces, data formats, error handling, edge cases,
  libraries, file layout, test coverage, what is out of scope. Always ask the user. Never decide one
  yourself, even when one option looks obvious. You may recommend an option and say why, but the user
  picks it.

If you cannot tell which kind a point is, treat it as a decision.

## 2. Ask until nothing is open

1. Read the goal and explore just enough of the code to find the facts and to see which decisions the goal
   leaves open.
2. List the open points. Go through these areas and note every point in each that is not already settled
   word for word by the user:
   - **Goal and scope:** what "done" means, and what is explicitly not part of the change.
   - **Behaviour:** inputs, outputs and side effects for each feature, including the normal case.
   - **Edge cases and errors:** empty, missing, invalid, duplicate or very large inputs; failures of
     anything the code calls; what the user sees in each case.
   - **Interfaces:** exact names, signatures, types, routes, CLI flags, config keys, schemas, file formats.
   - **Placement:** which files to create or change, and where new code goes in them.
   - **Constraints:** libraries to use or avoid, style rules, compatibility (versions, platforms),
     performance limits.
   - **Tests and verification:** which tests to add or change, which cases they cover, and which commands
     from `allowedCommands` prove the step works.
   - **Existing behaviour:** anything the change could break, and whether that is acceptable.
3. Ask the questions in rounds. Use the AskUserQuestion tool when it is available (up to 4 questions per
   call); otherwise ask in a numbered list. Each question must stand on its own: say what you found and
   name the thing it is about, because the user may see only the question. Put your recommended option
   first and mark it "(Recommended)".
4. Treat answers carefully:
   - An answer that is vague ("whatever you think", "the usual way", "make it robust") is not a decision.
     Offer concrete options and ask again.
   - An answer that opens a new point (a new edge case, a new file) adds that point to the list.
   - An answer that contradicts an earlier one: show both and ask which one holds.
5. Repeat until every point on the list is a confirmed fact or a decision the user made. Then say so
   before you split the plan into steps.

## 3. Write the plan down

Once the run folder exists, write `<run folder>/plan.md` before the first spec:

```markdown
# Plan: <goal>
## Decisions
- <question> -> <the user's answer>
## Confirmed facts
- <fact> (source: <file:line or command>)
## Steps
1. <title>: <one-line scope>
```

Every line of every spec must trace back to this file. If you are about to write something into a spec that
is not in it, stop and ask the user first, then add the answer to `plan.md`.

## 4. Implement-ready check for every spec

Before you show a spec (`step-NN.md` or `step-NN-fixK.md`), check it against this list. If a check fails,
fix the spec, or ask the user if the fix needs a decision.

- Every file to create or change is named by its exact path.
- Every interface is written out in full: name, parameters, types, return value, errors.
- Every behaviour, edge case and error case decided in `plan.md` that belongs to this step is in the spec.
- Every acceptance criterion can be checked by reading the diff or running a verify command.
- Every verify command is in `allowedCommands`.
- "Out of scope" names what DeepSeek must not touch.
- No placeholder or hedge words are left: "TBD", "etc.", "e.g.", "as needed", "if appropriate",
  "something like", "handle errors properly", "and so on".
- Nothing in the spec is a choice you made yourself.

## 5. Review each spec with the user

Follow `approvalMode` from the resolved config. With `step` (the default), do this for every spec
before it is delegated, including fix specs:

1. Show the full spec text in your message. The user does not see tool output, so writing the file is not
   enough: copy its contents into your message.
2. Ask the user to approve it or say what to change.
3. If they ask for changes, update the spec, then show the full updated spec again and ask again.
   Record any new decision in `plan.md`.
4. Delegate only after an explicit approval of that version of the spec ("approved", "yes", "go ahead").
   If a reply is unclear, ask whether it is an approval.

With `plan` or `auto`, the user has chosen not to review each spec: follow `commands/delegate.md` for those
modes. Sections 1-4 still apply in every mode.

## 6. During the run

- **Review finds a problem the plan does not cover** (for example, an edge case nobody decided): do not
  choose the fix yourself. Ask the user, record the answer in `plan.md`, then write the fix spec.
- **A fix spec** lists each problem concretely (file, line or function, expected vs actual) and the change
  needed. It goes through the same check (section 4) and, in `step` mode, the same review (section 5).
- **The user changes their mind mid-run:** update `plan.md`, tell the user which accepted steps the change
  affects, and ask how to handle them before writing the next spec.
