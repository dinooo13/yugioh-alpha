# Agent pipeline

Six repo-committed stage agents (`triage`, `planner`, `implementer`, `reviewer`,
`qa-tester`, `docs-auditor`) drive the bean → plan → PR → review factory described in
[`docs/WORKFLOW.md`](../../docs/WORKFLOW.md).
Each agent handles **one** work item with fresh context; the **routines** are thin
orchestrators that only build the queue (via the `beans` CLI), spawn one agent per item,
and summarize. All per-item logic lives here, versioned and reviewable. A seventh
agent, [`orchestrator`](orchestrator.md), is the on-demand counterpart to the nightly
routines: invoked with bean ids (or "all ready beans"), it chains the stage agents per
bean until each reaches `approved`/`blocked`/`duplicate` — several beans in parallel.

## Single source of truth: the bean

The entire pipeline state lives on the **bean** — status, stage tags, plan, progress,
delivery pointers. The PR carries no pipeline state; it links back with a
`Bean: <bean-id>` line in its body. Every PR references exactly one bean (the
docs-auditor creates a bean for its audit PR). Review and QA findings are the only
artifacts on the PR itself, because they are tied to a head SHA.

**Tracker mechanics (every agent obeys this):** beans are files in the repo, so a state
change only exists once it is on `origin/main`. Bean updates are committed on `main`
only — commits touching nothing but `.beans/` — and pushed immediately
(`git pull --rebase origin main` first, retry once on conflict). Feature branches never
modify `.beans/`. Batch bean edits (don't push per checkbox): update at milestones —
PR opened, gates green, finished/blocked.

## Stage-tag state machine

Status stays coarse (`draft` → `todo` → `in-progress` → `completed`/`scrapped`); the
stage tags refine it. One tag, one writer at a time — each agent is the sole consumer
of its queue tag.

```
BEAN:  (new, no stage tag) ──triage──▶ needs-plan ──planner──▶ needs-plan-review ──human──▶ agent-ready ──implementer──▶ (in-progress, PR open)
                └─▶ tag duplicate (human scraps) / tag blocked (human unblocks)                 [draft]        [todo]           [in-progress]

DEV LOOP (status in-progress, PR open):
       (no stage tag = implementer owns it) ──gates green──▶ needs-review ──reviewer: approve──▶ needs-qa ──qa: pass──▶ approved ──human merges──▶ completed
                    ▲                                             │                                 │
                    └────── reviewer / qa: changes requested ─────┴─────────────────────────────────┘   (tag removed → back in the implementer queue)

       implementer blocked ⇢ tag blocked — exits every queue until a human removes the tag
```

Queues (all built from a fresh `main` checkout):

- **triage routine** → beans with status `todo`/`draft` and **no** stage tag
  (`beans list --json -s todo -s draft --no-tag needs-plan --no-tag needs-plan-review
  --no-tag agent-ready --no-tag needs-review --no-tag needs-qa --no-tag approved
  --no-tag blocked --no-tag duplicate --no-type epic --no-type milestone`)
- **planner routine** → beans tagged `needs-plan` (`beans list --json --tag needs-plan`)
- **implementer routine** → (1) resume: beans `in-progress` with no stage tag and an
  open PR; (2) start: beans tagged `agent-ready`; (3) sweep: beans tagged `approved`
  whose PR has merged → mark `completed`
- **reviewer routine** → beans tagged `needs-review` whose PR lacks a
  `<!-- routine:code-review sha={head} -->` comment for the current head SHA
- **qa routine** → beans tagged `needs-qa` (set by the reviewer on approve)
- **docs-audit routine** → no queue; one whole-repo audit per run, feeding one
  docs-only PR (with its own bean) into the reviewer queue

Review and QA are **sequenced**, each the sole consumer of its own tag: the reviewer
reads the diff (`needs-review`), then the qa-tester exercises the built app
(`needs-qa`). Either bounces the bean back to bare `in-progress` (tag removed), where
the implementer treats the blocking findings from both comment types as its work queue;
a fixed SHA re-enters at `needs-review`. **The `approved` tag is the merge-ready
signal** — review and QA have both passed, and the bean has left every agent queue.

Markers (idempotency): `<!-- routine:plan -->` (start of the `## Plan` section in the
bean body), `<!-- routine:triage -->` (start of the `## Triage` section, only on
duplicates/blocked), `<!-- routine:code-review sha=… -->` (PR review comment per SHA),
`<!-- routine:qa sha=… -->` (PR QA comment per SHA), `<!-- routine:docs-audit -->`
(docs-audit PR body). Progress lives in the bean body's `## Progress` section; the PR
URL and branch in its `## Delivery` section.

## Routine prompts

Paste these as the routine prompts; keep them thin — anything per-item belongs in the
agent files, not the routine. Every routine starts from a fresh checkout of
`dinooo13/yugioh-alpha` on `main` (`git pull` first).

### Triage routine (e.g. nightly, before planner)

> You are a non-interactive orchestrator for `dinooo13/yugioh-alpha`. Pull `main`, then
> list every bean with status `todo` or `draft` that has no stage tag
> (`beans list --json -s todo -s draft --no-tag needs-plan --no-tag needs-plan-review
> --no-tag agent-ready --no-tag needs-review --no-tag needs-qa --no-tag approved
> --no-tag blocked --no-tag duplicate --no-type epic --no-type milestone`). If none,
> report "nothing to triage" and stop. For each, spawn one fresh `triage` agent
> (subagent_type: "triage") — "Triage bean {id}" — one agent per bean, never reused.
> Collect only each verdict. Finish with a summary: queued for planning, duplicates,
> blocked (what's missing), skipped. Never tag, plan, or change anything yourself.

### Planner routine (e.g. nightly)

> You are a non-interactive orchestrator for `dinooo13/yugioh-alpha`. Pull `main`, then
> list every bean tagged `needs-plan` (`beans list --json --tag needs-plan`). If none,
> report "no beans need planning" and stop. For each bean, spawn one fresh `planner`
> agent (subagent_type: "planner") with the prompt "Plan bean {id}" — one agent per
> bean, never reused. Collect only each agent's short report. Finish with a summary:
> planned, skipped (why), unplannable (what's missing). Do not plan, write files, or
> change code yourself.

### Implementer routine (e.g. nightly, after planner)

> You are a non-interactive orchestrator for `dinooo13/yugioh-alpha`. Pull `main`, then
> build the queue: (1) resume — beans with status `in-progress`, no stage tag, and an
> open PR (check `gh pr list`); (2) start — beans tagged `agent-ready`; (3) sweep —
> beans tagged `approved` whose PR has merged: for these only, mark the bean
> `completed` (remove stage tags, append `## Summary of Changes`) and commit that to
> `main`. For each item in (1) and (2), spawn one fresh `implementer` agent
> (subagent_type: "implementer") with isolation: "worktree" — "Resume bean {id}" or
> "Implement bean {id}" — one agent per item, never reused. Items touching the same
> files run sequentially; otherwise agents may run in parallel in the background.
> Collect only outcomes (PR link, gate results, blockers). Finish with a summary:
> started, resumed, completed by sweep, ready for review, skipped (no plan), blocked
> (where). Never implement anything yourself, never push code to main, never merge.

### Reviewer routine (e.g. nightly, after implementer)

> You are a non-interactive orchestrator for `dinooo13/yugioh-alpha`. Pull `main`, then
> list every bean tagged `needs-review` (`beans list --json --tag needs-review`). For
> each, spawn one fresh `reviewer` agent (subagent_type: "reviewer") with isolation:
> "worktree" — "Review bean {id}" — one agent per bean, never reused. Collect only
> verdict, blocking count, comment link. Finish with a summary: approved (moved to QA),
> sent back to the implementer, skipped (already reviewed at head). Never review, fix,
> push, or merge yourself.

### QA routine (e.g. nightly, after the reviewer)

> You are a non-interactive orchestrator for `dinooo13/yugioh-alpha`. Pull `main`, then
> list every bean tagged `needs-qa` (`beans list --json --tag needs-qa`). For each,
> spawn one fresh `qa-tester` agent (subagent_type: "qa-tester") with isolation:
> "worktree" — "QA bean {id}" — one agent per bean, never reused. Collect only verdict,
> blocking count, comment link. Finish with a summary: approved (passed / QA not
> applicable), issues found (sent back to the implementer), untestable (why). Never
> test, fix, push, or merge yourself.

### On-demand full-pipeline run (no schedule — invoked by a human)

Not a scheduled routine but an interactive command: spawn the `orchestrator` agent
(subagent_type: "orchestrator") with the beans to run, e.g. "Run bean yugioh-alpha-a1b2
through the pipeline", several ids at once, or "Run all ready beans". It chains the
stage agents per bean (fresh agent per transition, beans in parallel, max 3 in flight)
until each bean is `approved`, `blocked`, or `duplicate`. **Invoking it delegates the
plan-promotion gate** (recorded in the bean body); the merge gate always stays human.

### Docs-audit routine (e.g. weekly)

> You are a non-interactive orchestrator for `dinooo13/yugioh-alpha`. Spawn one fresh
> `docs-auditor` agent (subagent_type: "docs-auditor") with isolation: "worktree" and
> the prompt "Audit the docs". Relay its report: PR link (or "docs in sync"), fix
> count, and any items needing human attention. Do not audit or fix anything yourself.

## Humans in the loop

Two gates are deliberately human: promoting a plan (remove `needs-plan-review`, add
`agent-ready`, set status `todo`) and merging a PR whose bean is tagged `approved` —
the signal that both code review and QA have passed. Everything else runs unattended.

One sanctioned shortcut: explicitly invoking the `orchestrator` on a bean delegates
the plan-promotion gate for that bean (the promotion is recorded in the bean body).
The merge gate is never delegated — nothing in this pipeline merges.
