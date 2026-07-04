# Development Workflow

How work flows from an idea to merged code in this repository. Work is tracked with
**beans** (`beans` CLI, files under [`.beans/`](../.beans/)) — beans are the backlog and
the source of truth for *what* to build. GitHub is used only for pull requests, i.e. for
*delivering* code.

## 1. Requirements live in beans

Every new requirement, feature idea, or bug starts as a **bean**. Create it with the CLI
(`beans create "Title" -t <type> -d "..."`) and structure the body so a planner can work
with it:

- **Feature / improvement** — `## Problem` → `## Proposed Solution` (optional) →
  `## Trade-offs` (optional) → `## Effort` (Small / Medium / Large). Reference concrete
  files where helpful.
- **Bug report** — Description → Steps to reproduce → Expected vs Actual → Environment.

## 2. Triage & tags

When a bean comes in, classify it. Every bean should get at least a **type** and an
**effort**; add **priority** and **area** when known:

| Group | Where it lives | Values | Use |
| --- | --- | --- | --- |
| **type** | bean `type` field | `feature`, `bug`, `task`, `epic`, `milestone` | What kind of work it is. Docs/refactor/chore/test work is `task` (add a descriptive tag like `docs` or `security` when useful). |
| **priority** | bean `priority` field | `critical`, `high`, `normal`, `low`, `deferred` | How urgent. |
| **effort** | tag | `effort:small`, `effort:medium`, `effort:large` | Rough size (mirrors the bean's *Effort* section). |
| **stage** | tag | `needs-plan`, `needs-plan-review`, `agent-ready`, `needs-review`, `needs-qa`, `approved`, `blocked`, `duplicate` | Where it stands in the pipeline. `needs-plan-review` = plan awaits human approval; `approved` = review and QA passed, ready for human merge. |
| **area** | tag | `area:catalog`, `area:inventory`, `area:decks`, `area:formats`, `area:ai`, `area:social`, `area:tournament`, `area:auth`, `area:ui`, `area:infra` | Part of the app affected (see [Roadmap.md](Roadmap.md) for the product areas). |

Bean **status** stays coarse and native: `draft` while a bean is being shaped and planned,
`todo` once a human has approved the plan (`agent-ready`), `in-progress` from the moment a
PR exists until it merges, then `completed` (or `scrapped`). The stage tags refine those
phases; use only the tags listed above — never invent new stage tags.

If a bean is blocked **by another bean**, use the native relation
(`beans update <id> --blocked-by <other>`), not the `blocked` tag — the `blocked` tag
means "blocked on a human".

> **Tracker mechanics:** beans are files in the repo, so a state change is only visible
> once it lands on `main`. Bean updates are **tracker operations**: commit them on
> `main` only, touching nothing but `.beans/`, and push immediately
> (`git pull --rebase origin main` first). Feature branches never modify `.beans/`.

## 3. Branching

- Branch off `main`. One logical change per branch.
- Naming: `claude/{bean-short-id}-{slug}` for agent-driven work (e.g.
  `claude/f0ez-inventory-search`), or `<type>/<short-slug>` for human work (e.g.
  `feat/deck-validation`, `fix/catalog-search`).
- Keep branches short-lived; rebase on `main` rather than letting them drift.

## 4. Pull requests

Open a PR using the [PR template](../.github/PULL_REQUEST_TEMPLATE.md):

- **Link the bean** with a `Bean: <bean-id>` line in the PR body (e.g.
  `Bean: yugioh-alpha-f0ez`); the bean records the PR URL and branch in its
  `## Delivery` section. Every PR references exactly one bean.
- Sections: `## Summary`, `## Changes`, `## Test plan` (or `## Verification`).
- Keep PRs focused and reviewable; describe what was verified and what couldn't be.
- Squash-merge into `main`. After merging, the bean is marked `completed` (the
  implementer routine also sweeps merged PRs and completes their beans).

## 5. Definition of done

A change is done when all of the following hold:

- The project's verification gates pass — the scripts defined in `package.json` once the
  stack lands (expected: `test`, `typecheck`, `build`). Gates that don't exist yet are
  skipped and noted as such.
- Tests are added or updated for any behavior change.
- Documentation is updated when relevant — including a new **ADR** when the change is
  structural.
- The bean's todo items are checked off and it carries a `## Summary of Changes`
  section when completed.

## 6. Automation pipeline

Triage, planning, implementation, first-pass review, acceptance QA, and documentation
upkeep are automated by six repo-committed agents (`.claude/agents/`: `triage`,
`planner`, `implementer`, `reviewer`, `qa-tester`, `docs-auditor`) driven by thin
routines. New beans without a stage tag are triaged automatically (classification +
dedupe) into the planner queue. The stage tags on the **bean** form the entire state
machine (`needs-plan` → `needs-plan-review` → `agent-ready` → in-progress →
`needs-review` → `needs-qa` → `approved`, bouncing back on findings) — a single source
of truth; the PR carries no pipeline state. Two gates stay human: promoting a plan to
`agent-ready`, and merging a PR whose bean is `approved`. An `orchestrator` agent can
run one or many beans through the whole pipeline on demand; invoking it delegates the
plan-promotion gate for those beans, while merging always stays human. Full detail in
[`.claude/agents/README.md`](../.claude/agents/README.md).

## 7. When to write an ADR

Add an Architecture Decision Record in `docs/adr/` for any decision that changes
something structural: the **data schema**, the **persistence** layer, the **auth** model,
a **core dependency**, or a cross-cutting pattern. Don't rewrite an accepted ADR to
reverse it — add a new one and mark the old as superseded.
