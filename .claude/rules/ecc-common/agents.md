# Agents

Agents live in `.claude/agents/` and are called through the Agent tool by name (for example `planner`, `code-reviewer`, `spec-reviewer`, `security-reviewer`, `tdd-guide`, `e2e-runner`). List them with `ls .claude/agents`. Each sets `model:` and `effort:` by task class (`performance.md`); override only with a reason in the run's description.

- Delegate when it earns its cost: independent work that can run in parallel, or a review that needs fresh context. Do not delegate trivial edits.
- Run independent agents in parallel.
- The agent that delegates owns the result: wait for its children, integrate their output, and finish with the deliverable. Never end a turn with "waiting for background agents": the harness Stop hook holds a stop once while a background helper this session started has no end record (#86); stop a helper you no longer need with TaskStop.
- **Unfinished work goes in `.harness/work/<run>/`** (gitignored, writable during a harness run), or the session scratchpad. Move it into the tree only when it is finished, then commit and push in one step. In cloud sessions the platform's Stop hook (`~/.claude/stop-hook-git-check.sh`, not this repo's and never to be edited or bypassed) blocks every stop while the checkout has tracked changes, untracked files that are not gitignored, or unpushed commits; helpers writing into the tree while the turn ends make it post the same commit message again and again.
- In an unattended harness run, do not insert planning or review hops that the spec did not ask for; each Stop attempt costs an iteration.
- Review is two-axis: `spec-reviewer` (did it build what the spec asked) and `code-reviewer` (does it follow the standards), in parallel. A change made from a spec needs both to pass.
