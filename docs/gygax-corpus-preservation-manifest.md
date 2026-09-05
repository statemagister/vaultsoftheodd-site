# Gygax Corpus — Preservation and Reproduction Manifest

**Written:** 5 September 2026, at commit `d579f2b` (Part XIII closed complete)
**Corpus state:** 12 objects · 2,079 testimony units · 2,423 context rows · 2,106
evidence assets · 453 persons · 6,022 discovery rows · 80 annotations

## Why this document exists

The working corpus database and the staged evidence tree exist **only inside an
ephemeral container**. This document records what an external archival copy must
contain, and — more usefully — establishes that the corpus is a **derived** artefact
rather than a unique original, so that losing the container costs a rebuild rather than
the material itself.

Nothing here contains corpus plaintext, and nothing here contains the passphrase.

## The central finding, verified

**All 2,106 evidence assets in the corpus are byte-identical to files inside evidence
packages held outside the container.** Every asset's sha256 was compared against the
sha256 of every file inside all 45 uploaded package archives; the match rate is
2,106 / 2,106, with zero assets existing only in the container.

The v1 root database is likewise held: `gygax_enworld.sqlite`, inside
`gygaxenworldsearchenginev1.zip`. It was tested as a live migration input at the time of
writing and produced `MIGRATION OK` with all eleven verification checks passing.

**Therefore the corpus can be rebuilt from held artefacts plus this git repository.**
The plaintext SQLite file is reproducible output, not an irreplaceable original.

## What the archive must contain

| Layer | Where it lives now | Archive action |
|---|---|---|
| v1 root database | `gygaxenworldsearchenginev1.zip` (`e337288e…`) | **archive** — the migration's only root input |
| Evidence packages | 45 uploaded ZIPs, ~477 MB of contributing archives | **archive** — the sole source of all 2,106 assets |
| Ingestion code, frozen schema + lock, acceptance registry | this repository | already durable via git remote |
| Ingestion order | git history (see below) | already durable via git remote |
| Working SQLite + staged evidence tree | container only | **reproducible; no archival need** |
| Encrypted deployable `.enc` | does not exist yet | see "Preserved ≠ deployed" |

Superseded drafts do not need archiving for reproduction, but they are cheap and are
worth keeping as the audit trail of what was corrected and why — several corrections in
this project were only demonstrable by diffing a package against the one it replaced.

## Limits of the recoverability test — read this before trusting the classification

The asset-hash test proves that **every asset is held somewhere**. It does **not** by
itself identify the minimal authoritative package set, and a first attempt to derive one
from it was wrong in both directions:

- **It marks metadata-only packages as "non-contributing".** The Stage A and Dragonsfoot
  regularisations carry `context_segments.jsonl` and `discovery_replacements.jsonl` but
  no card images, so an asset-based test cannot see their contribution at all — yet 645
  Stage A context rows in the corpus come from one of them. The v1 root database has the
  same problem: no assets, and completely essential.
- **It marks superseded drafts as "required".** Where an upstream correction was metadata
  only, the corrected package and the package it replaced contain *byte-identical* card
  images, so both match every asset equally. XIII-B, XIII-C (three versions), Part III and
  Part VII all have this shape.

Where two packages are interchangeable on assets, authority is decided by the package's
own `SUPERSESSION_NOTICE.md`, not by hashes. For the Stage A regularisation chain that
notice names **v4 (`805277445f5f`)** as superseding v1, v2 and v3; all four carry the same
645 context rows, so the row count cannot discriminate and the notice is the only
evidence that does.

## Reproduction chain

The corpus is rebuilt by replaying, in order:

```
gygax-v2-migrate.mjs            v1 root database  ->  v2 skeleton (no testimony units)
gygax-v2-ingest-enworld-cards   Stage A: 532 units
  + Stage A reconstruction regularisation (186 resolved, 26 never cross-page)
  + Stage A quoted-question regularisation v4
gygax-v2-ingest-dragonsfoot     + batch 01 regularisations
gygax-v2-ingest-ward-greyhawk2  (v3 package)
gygax-v2-ingest-gamespy-part1   + reconciliation overlay (7 continuous stitched cards)
gygax-v2-ingest-cyclopeatron
gygax-v2-ingest-gamasutra-2002
gygax-v2-ingest-wargamers-digest-1974
gygax-v2-ingest-ae15-letter
gygax-v2-ingest-white-dwarf-14
gygax-v2-ingest-22-questions
gygax-v2-ingest-oerth-journal-12
gygax-v2-ingest-sacco-interview
gygax-v2-ingest-enworld-part03 .. part07          (corrected packages)
gygax-v2-ingest-enworld-part13a / 13b / 13c       (corrected packages)
```

The order is recoverable from git history: every ingestion is its own commit, and each
commit message records the package involved, the counts added and the gate results.

Determinism is not assumed — it is checked. Every ENWorld segment ingestion in this
project was re-run from a pre-ingestion snapshot into a separate database and compared on
id-independent content hashes. The most recent (XIII-C) reproduced hash `3e9d2e2d…` over
15,837 rows.

## Preserved ≠ deployed

`static/research/gygax/v2` does not exist. "Pushed" and "preserved" and "deployed" are
three different states, and the project is currently in the first only:

- **Pushed** — ingestion code, schema lock, acceptance registry, conformance record and
  this manifest are on the remote branch.
- **Preserved** — requires the v1 root and the evidence packages to be held somewhere
  durable and independent of both this container and any single machine. The material
  qualifies today only because the packages were uploaded from elsewhere and still exist
  elsewhere; that is a property of how the work happened, not a deliberate archive.
- **Deployed** — requires an encrypted `.enc` artefact built from the corpus. The
  plaintext SQLite and the staged evidence originals are gitignored and must stay so, and
  the passphrase must never enter the repository or any deployed artefact.

## Standing constraints

- The frozen v2.1 schema is not to be changed; `assertSchemaFrozen()` refuses drift.
- The derived database is never patched by hand. Defects are fixed in the evidence
  package upstream and the ingestion re-run.
- Plaintext SQLite, WAL/SHM sidecars and evidence originals stay gitignored. Only an
  encrypted artefact is deployable.
