# Kickoff prompt for Claude Code

Open a terminal in the repo folder, run `claude`, and paste this as the first message.

---

You are the orchestrator for the Lailark build. Read `CLAUDE.md` in full, then
`DECISIONS.md`, then `TASKS.md`, then `QUESTIONS.md`. Do not read the strategy docs in
full yet; read the sections each task cites when you reach that task.

Then:

1. Confirm the repo state: `git status`, `git log --oneline`, and that `origin` points
   at `github.com/delta2511/lailark`. If `main` has not been pushed, push it.
2. Create the branch `milestone-1-foundations` from `main`.
3. Work through Milestone 1 in `TASKS.md` exactly as CLAUDE.md §4 describes: one task
   at a time, a builder subagent with the tagged model, a fresh tester subagent, at
   most three fix rounds, ledgers updated, one commit per task, no stopping between
   tasks and no questions to me except through `QUESTIONS.md`.
4. When M1.10 is written, stop and print the summary. I will test and come back with
   "continue".

Before you start M1.1, print a one-paragraph plan of the order you will do the M1 tasks
in and which model each builder uses, then begin without waiting for me.

---

## At each break

When Claude Code stops at the end of a milestone:

1. Open `docs/milestones/MILESTONE-<n>-TEST.md` and test what it says to test.
2. Reply with what broke, what to change, and the answers to anything in
   `QUESTIONS.md` and the assumptions list. Then say `continue`.
3. Claude Code fixes, then prints the merge and tag commands. Run them (or say "merge
   it" and it will run them), and it starts the next milestone.

## If a session dies

Claude Code sessions can be interrupted. To resume, run `claude` in the repo and paste:

> Resume the Lailark build. Read `CLAUDE.md`, then `TASKS.md` to find the first unticked
> task in the current milestone (the branch name tells you which), check `git status`
> and `git log -5` for uncommitted or half-finished work, and carry on from there under
> the same protocol.
