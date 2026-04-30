# Session: 2026-04-28 — Solution Records + Compatibility Hardening

## Context

This session moved AgentNet closer to the `GOAL.md` MVP idea graph by introducing a reusable solution-shaped memory inside the existing message pipeline.

Before this session, the system primarily stored:

- the original message
- normalized SDG hypotheses
- usage metadata

That was useful for retrieval, but it still treated memory as "messages we saw" rather than "solutions we can reuse".

The goal of this session was to introduce a structured solution record aligned with the PRD's:

`Problem -> Approach -> Variant -> Outcome`

without breaking the current API surface or existing stored documents.

## What Changed

### 1. Added a solution-shaped data model

The request/type layer now supports a `solution` payload with:

- `problem`
- `approach`
- `variant`
- `outcome`

where `outcome` supports:

- `status`
- `summary`
- `metrics`
- `evidence`

This gives the system a first-class reusable memory unit instead of relying only on normalized intent/tag output.

### 2. Derived solution records during message storage

`storeMessage()` now builds a `solution` record for every stored message.

If a caller sends explicit solution data, the system preserves it.

If a caller only sends plain text or a legacy message shape, the service derives a solution record automatically:

- `problem` from explicit `solution.problem`, else `intent`, else `type`, else `"unknown"`
- `approach` from the top normalized intent, converted into a human-readable label
- `variant` from the top normalized tags, else `"default"`
- `outcome` from explicit data if provided, else a safe default pending state

This means all new writes can participate in a solution-centric memory model, even before a dedicated graph store exists.

### 3. Persisted solution records in MongoDB

The `Message` schema now includes a `solution` object so the reusable record is stored alongside:

- `original`
- `normalized`
- `agentId`
- `usageCount`

This is still an embedded model, not a separate graph node system, but it is the first concrete bridge from message storage toward the PRD's idea graph.

### 4. Returned solution records from the API

The API now includes the structured solution record in the create response.

Search results also expose the solution record, which makes retrieval more useful for downstream reuse:

- clients can rank by search score
- inspect the reusable solution summary
- later attach validation and reputation logic to the same record

### 5. Hardened validation and input parsing

This session also tightened the solution input path.

Validation now checks:

- `solution.problem`
- `solution.approach`
- `solution.variant`
- `solution.outcome.status`
- `solution.outcome.summary`
- `solution.outcome.metrics`
- `solution.outcome.evidence`

Malformed payloads are rejected before persistence.

Examples:

- `solution must be an object`
- `solution.outcome must be an object`
- `solution.outcome.status must be a valid status`

### 6. Standardized validation error messages

Solution validation messages were normalized to one consistent style:

- `solution.problem must be a non-empty string`
- `solution.outcome.status must be a valid status`

This removed the earlier mix of `Field 'solution...` and plain field-path error strings.

### 7. Preserved backward compatibility for legacy documents

One important follow-up in this session was compatibility hardening.

The initial schema version made solution subfields required. That was safe for new writes because `buildSolutionRecord()` always derives values, but it created unnecessary risk for older documents that predate the `solution` block.

To avoid breaking legacy data, the schema was relaxed so existing documents without `solution` still remain valid.

This means:

- new writes still get a complete derived `solution`
- old documents without `solution` can still be read safely

## Files Touched

- `src/types/protocol.ts`
- `src/models/Message.ts`
- `src/api/services/messageService.ts`
- `src/api/controllers/messageController.ts`
- `test/messageService.test.ts`
- `test/integration/search-usage.test.ts`

## Validation

The following checks passed after the changes:

- `npm test`
- `npm run type-check`
- `npm run build`

Additional regression tests were added for:

- derived solution records when explicit solution data is absent
- malformed `solution` payload rejection
- malformed `solution.outcome` rejection
- standardized nested validation messages
- integration persistence of the solution record in MongoDB

## Where This Moves Us Relative to GOAL.md

### What this session directly advances

This session materially advances `GOAL.md` section `5.4 Idea Graph (Core Engine)`:

`Problem -> Approach -> Variant -> Outcome`

We do not yet have a graph database or relationship edges, but we now store a shape that matches the PRD's core reuse model.

It also helps `5.2 Solution Retrieval Engine` because search results can now return reusable solution units instead of only message/intention metadata.

It partially supports `5.6 Context Compression Layer` because a stored solution record is closer to an "experience card" than a raw message.

### What is still missing

We are still short of the full PRD in several important ways:

- no dedicated idea graph store
- no explicit links between problems, approaches, variants, and outcomes across records
- no reputation scoring
- no validation workflow that upgrades a solution from pending to proven
- no CLI MVP entry point
- no safe code adaptation pipeline

So this session should be viewed as a foundational data-model step, not completion of the idea graph.

## Current Architecture Reality

After this session, the architecture looks like this:

1. A message enters through the current API.
2. The service normalizes it via SDG.
3. The service derives or accepts a structured solution record.
4. Mongo stores both the message and the reusable solution shape.
5. Search can now surface reusable solution data alongside ranking metadata.

This is still document-first architecture.

It is not yet:

- graph-first
- reputation-aware
- validation-aware
- CLI-driven

But it is much closer to the PRD than the earlier "message-only memory" version.

## Risks / Open Questions

### 1. Embedded model vs separate solution store

Right now `solution` is embedded inside `Message`.

This is a good incremental step because it reuses the current pipeline and avoids a large refactor.

However, it may become limiting when we need:

- multiple outcomes for the same approach
- shared approaches across many problems
- explicit relationship queries
- reputation at the solution or contributor level

At that point, a separate `Solution` collection or graph structure will likely be necessary.

### 2. Derived defaults may be too generic

When callers do not provide explicit solution metadata, the derived values are useful but still approximate.

Examples:

- `approach` is inferred from normalized intent labels
- `variant` is inferred from tags
- `outcome` defaults to pending

This is fine for bootstrapping, but higher-quality reuse will require:

- explicit submission payloads
- richer feedback
- validation events

### 3. Legacy data remains readable but not enriched

Relaxing the schema preserves compatibility, but old documents still do not magically gain full solution records.

That leaves a future decision:

- backfill old documents with derived solution records
- or only enforce the richer model for new writes

## Recommended Next Steps Toward GOAL.md

### 1. Add an explicit solution submission / update path

Why:

- right now the system can derive solution records, but high-quality `approach`, `variant`, and `outcome` data should eventually come from agents, not inference alone

Suggested slice:

- support explicit `solution` payloads in `POST /api/message`
- add a focused endpoint to update `outcome`
- allow clients to mark a solution as validated, reused, or failed

This would directly strengthen:

- `5.2 Solution Retrieval Engine`
- `5.4 Idea Graph`
- `5.6 Context Compression Layer`

### 2. Separate reusable solutions from raw messages

Why:

- the current embedded model is a bridge, not the destination

Suggested slice:

- introduce a dedicated `Solution` model or lightweight JSON graph model
- keep `Message` as intake/audit
- link a message to one solution record

This would move the codebase much closer to:

- `5.4 Idea Graph (Core Engine)`
- MVP scope item: `simple idea graph (even JSON DB)`

### 3. Add outcome feedback endpoints

Why:

- the PRD depends on contribution back into the network
- stored solutions need a lifecycle, not just storage

Suggested slice:

- `POST /api/solutions/:id/outcome`
- update `status`, `summary`, and `metrics`
- later compute adoption metrics from these updates

This is the cleanest route toward:

- `% of reused solutions`
- `solution success rate`
- future reputation scoring

### 4. Add a basic reputation signal

Why:

- the PRD explicitly wants ranking influenced by success and reuse, not just text match

Suggested MVP version:

- derive a simple contributor score from:
  - reuse count
  - validated outcomes
  - failed outcomes
- apply it as a multiplier inside search ranking

This maps to:

- `5.5 Agent Reputation System`
- `10. Success Metrics`

### 5. Improve retrieval output to return solution summaries first

Why:

- the PRD says the system should return ranked approaches and summaries before raw code

Suggested slice:

- adjust search responses so the primary summary is based on `solution.approach` + `solution.outcome.summary`
- keep intent/tags/confidence as supporting metadata

This would make the system feel more like:

> "Google for agents, based on outcomes"

and less like a message search API.

### 6. Add the CLI MVP entry point

Why:

- the PRD explicitly includes CLI in MVP scope

Suggested slice:

- basic command:

```bash
agent query "angular dashboard"
```

- wire it to `/api/search`
- print:
  - top approaches
  - summaries
  - usage
  - confidence

This would make the system usable in the way `GOAL.md` describes.

### 7. Restore real semantic learning

Why:

- the SDG system is strongest when embeddings are active
- fallback-only mode weakens clustering and discovery

Suggested slice:

- configure one working provider
- verify provider-backed normalization on real requests
- seed enough data to make clustering meaningful

This will improve both:

- solution derivation quality
- retrieval quality

## Practical Recommendation

If prioritizing for the fastest path to visible MVP progress, the best next order is:

1. Add explicit solution outcome updates.
2. Split reusable solutions into a dedicated lightweight store or graph layer.
3. Use outcome + reuse data in ranking.
4. Add the CLI.

That sequence gives the project:

- better data quality
- better retrieval quality
- clearer alignment with the PRD
- visible product progress without needing the full long-term architecture yet

## Bottom Line

This session did not finish the PRD's idea graph, but it created the first durable data structure that actually resembles one.

Before this session:

- AgentNet stored messages with semantic normalization

After this session:

- AgentNet stores messages plus reusable solution-shaped memories

That is an important shift from "searching conversations" toward "reusing intelligence".
