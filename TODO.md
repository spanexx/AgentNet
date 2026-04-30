# AgentNet Next 5 TODOs

Based on `GOAL.md` and the current implementation, the project is at:

- working backend foundation
- semantic normalization and search in place
- solution-shaped memory stored in MongoDB
- explicit reuse tracking available
- no dedicated solution graph, reputation model, or CLI yet

The next steps below are ordered for the fastest path from "useful backend" to "demoable MVP".

## 1. Solution Outcome Update API

Type: AFK

Why first:
- The PRD depends on agents contributing outcomes back into the system.
- Reuse alone is not enough; solutions need a lifecycle.

What to build:
- Add a focused endpoint to update `solution.outcome` for an existing stored record.
- Support status transitions such as `pending`, `validated`, `reused`, and `failed`.
- Allow clients to send outcome summary, metrics, and evidence.

Suggested API:

```http
POST /api/message/:id/outcome
```

Acceptance criteria:
- A client can update outcome status for an existing message-backed solution.
- Validation rejects malformed outcome payloads with consistent errors.
- Search results return the updated outcome data.
- Unit and integration tests cover success and failure cases.

PRD alignment:
- `5.2 Solution Retrieval Engine`
- `5.4 Idea Graph`
- `5.6 Context Compression Layer`

## 2. Dedicated Solution Store

Type: AFK

Blocked by:
- `1. Solution Outcome Update API`

Why now:
- The current `solution` object is embedded inside `Message`, which is a bridge but not the target architecture.
- A dedicated solution store is the cleanest way to move toward the PRD's idea graph without needing a full graph database yet.

What to build:
- Introduce a dedicated `Solution` model or lightweight JSON graph model.
- Keep `Message` as intake and audit history.
- Link each stored message to a reusable solution record.

Acceptance criteria:
- New writes create or attach to a dedicated solution record.
- Existing API responses can still expose solution data without breaking consumers.
- Solution data can be queried independently from raw message documents.
- Migration or compatibility handling is documented for legacy records.

PRD alignment:
- `5.4 Idea Graph (Core Engine)`
- `11. MVP Scope: simple idea graph`

## 3. Ranking With Reuse and Outcome Signals

Type: AFK

Blocked by:
- `1. Solution Outcome Update API`
- `2. Dedicated Solution Store`

Why next:
- Current ranking is heuristic and mostly based on intent, tags, confidence, and recency.
- The PRD wants ranking based on successful reuse and validated outcomes.

What to build:
- Extend search scoring to include reuse count and outcome quality.
- Prefer validated and reused solutions over pending ones.
- Keep the current search API but make ranking outcome-aware.

Acceptance criteria:
- Search ranking changes when solution outcome and reuse history differ.
- The scoring policy is documented in code or docs.
- Search responses still include summary, score, usage, confidence, and solution metadata.
- Regression tests verify ordering for at least 3 realistic scenarios.

PRD alignment:
- `5.2 Solution Retrieval Engine`
- `5.5 Agent Reputation System`
- `10. Success Metrics`

## 4. Basic Reputation Multiplier

Type: AFK

Blocked by:
- `3. Ranking With Reuse and Outcome Signals`

Why here:
- Once solution-level evidence exists, contributor-level trust becomes meaningful.
- This is the smallest useful version of the PRD reputation system.

What to build:
- Compute a simple reputation score per `agentId`.
- Start with a transparent formula using:
  - validated outcomes
  - reuse count
  - failed outcomes
- Apply that score as a ranking multiplier in search.

Acceptance criteria:
- Each agent has a derived reputation value.
- Reputation affects ranking in a predictable, testable way.
- The system handles missing or anonymous agent identity safely.
- The formula is simple enough to explain and tune later.

PRD alignment:
- `5.5 Agent Reputation System`
- `15. Competitive Edge`

## 5. CLI MVP

Type: AFK

Blocked by:
- `3. Ranking With Reuse and Outcome Signals`

Why this unlocks the MVP:
- The PRD explicitly calls for CLI as the entry point.
- A CLI makes the project demoable in the product shape described by `GOAL.md`.

What to build:
- Add a small CLI command that queries the existing API.
- Start with:

```bash
agent query "angular dashboard"
```

- Print:
  - top approaches
  - outcome summaries
  - usage
  - confidence
  - contributor or reputation signal when available

Acceptance criteria:
- A local user can query the backend from the terminal.
- Output is readable and optimized for quick decision-making.
- The CLI handles empty results and server errors cleanly.
- README includes setup and usage examples.

PRD alignment:
- `5.7 CLI Interface`
- `11. MVP Scope`

## After These 5

Once the five items above are done, the next likely milestones are:

- restore and verify a real embedding provider in live runtime
- improve summaries so search returns approach/outcome-first results
- add validation workflow or evidence review
- begin safe code adaptation flow
- consider graph DB adoption if relationship queries become central

## Recommended Build Order

1. `Solution Outcome Update API`
2. `Dedicated Solution Store`
3. `Ranking With Reuse and Outcome Signals`
4. `Basic Reputation Multiplier`
5. `CLI MVP`
