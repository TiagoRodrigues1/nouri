# Backend design rationale

## Problem

The app must combine manually entered records with wearable data that can arrive late, change, or disappear. It must give the person a useful daily view and explain the facts behind each AI suggestion. Food values also come from catalogs with different coverage, quality, and reuse terms. The repository had no existing code or schema to preserve. TypeScript, Oxlint, and the vendored anti-slop rules are required.

## Usage (caller's view)

The mobile app records food with `POST /v1/food-entries`, uploads a page of device changes with `POST /v1/wearable-imports`, reads `GET /v1/days/{date}`, and reads and responds to suggestions. Each write has an idempotency key. The app does not calculate authoritative totals, deduplicate imported samples, or send free-form prompts to the model. The full examples and derived type sketch are in [backend-architecture.md](backend-architecture.md#callers-view).

## Shape

One Node.js API, one worker, and one PostgreSQL database form a modular monolith. Domain tables hold current facts. A narrow source mapping and revision history preserve wearable provenance and correction history. The `journal`, `wearables`, `days`, and `coaching` interfaces hide storage and AI mechanics. HTTP adapters parse external data; domain functions work with typed values. This follows Poteto Mode's Model the Domain, Boundary Discipline, Type System Discipline, and Make Operations Idempotent principles. A food entry stores its nutrient snapshot and catalog source, and a suggestion stores the evidence revisions it used. That makes history and explanations reproducible. The foods module keeps provider records separate so Open Food Facts licensing cannot silently affect other catalog data.

The interfaces are deliberately small. A client makes one call to record a fact or import changes. It never orchestrates validation, source mapping, database writes, job scheduling, or model output checks. The complexity stays inside the module that owns the invariant.

## Synthesis decision

I compared two structurally different designs. Candidate A used normalized domain tables and transactional reads. Candidate B used an append-only observation ledger with rebuildable projections. Candidate A is the base because the app's main screens and coaching snapshots need current, cross-domain facts and simple consistency semantics. I brought source identity, revisions, and evidence references from candidate B into that base. I rejected a generic observation ledger as the primary store because it would make every day read and correction depend on payload versions and projection freshness. Both candidates passed the red-flag screen after keeping provider wire formats, SQL tables, and model SDK objects behind domain interfaces.

## Tradeoffs accepted

- We accept one database in exchange for transactions across journal writes, source identity, and job creation.
- We accept a small revision history in exchange for deduplication, correction tracking, and evidence-backed suggestions.
- We accept duplicated nutrient values on food entries in exchange for stable historical totals after catalog changes.
- We accept one worker process and database jobs in exchange for a simpler deployment until workload measurements justify another queue.
- We accept bounded, sometimes less conversational suggestions in exchange for testable policy and user control over goal changes.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Append-only observation ledger plus projections | Source correction history and replay | It exposes projection lag and payload versioning to routine reads and makes simple edits depend on replay semantics. |
| Services for nutrition, activity, sleep, and coaching | Independent service deployment | It exposes cross-service consistency and distributed tracing to every suggestion before scaling needs justify it. |
| One generic JSON `health_events` table | Early schema changes | It moves validation and query complexity into each reader, especially strength sets and nutrient totals. |

## Open questions and risks

- Does the product intend consumer coaching only, or advice that needs clinical review?
- Is Portugal the first food market, and can PortFIR reuse terms be confirmed? Does the product accept Open Food Facts share-alike terms for packaged foods?
- What is the first mobile platform and first wearable data scope?
- Which model provider and data region meet the product's privacy promise?
- What evidence and safety thresholds should permit a calorie target proposal?

## Next implementation step

The manual food slice now covers idempotent creation, correction, deletion, nutrient snapshots, and a local-day read with a PostgreSQL integration test. The next step is to add another record kind only after the client can use this API in a real product flow.
