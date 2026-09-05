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

## Reproduction chain — TESTED, not asserted

On 5 September 2026 the corpus was rebuilt end to end **from held artefacts only** — the
uploaded package ZIPs plus this repository — into a fresh database, and compared against
the canonical `d579f2b` corpus on id-independent content:

| table | canonical | rebuilt | content |
|---|---|---|---|
| documentary_objects | 12 | 12 | identical |
| source_families | 12 | 12 | identical |
| testimony_units | 2,079 | 2,079 | identical |
| unit_context | 2,423 | 2,423 | identical |
| discovery_text | 6,022 | 6,022 | identical |
| evidence_assets | 2,106 | 2,106 | identical |
| evidence_sources | 2,727 | 2,727 | identical |
| persons | 453 | 453 | identical |
| coverage | 27 | 27 | identical |
| annotations | 80 | 80 | identical |

The rebuild also produced a staged evidence tree of 2,106 files, **byte-identical to the
canonical one on every path**, and passes the conformance audit (12 objects, 0 defects)
and the reconstruction acceptance gate (605 accepted, 0 blocked).

**Reproducibility is therefore demonstrated, not argued.**

### The working recipe

```
migrate                v1 root DB -> v2 skeleton
enworld-cards          stageA pkg (inner dir gygax_pdf_post_cards_v2_staging/)
                         --regularization <stageA reconstruction pkg>
                         --quoted-questions <stageA quoted-question pkg v4>
dragonsfoot            df pkg (inner dir mnt/data/gygax_dragonsfoot_cards_batch01/)
                         --regularization <df reconstruction pkg> --quoted-questions <df qq pkg>
ward-greyhawk2         corrected v3 package
gamespy-part1          unit-cards v2  --reconciliation <gamespy reconciliation pkg>
cyclopeatron · gamasutra-2002 · wargamers-digest-1974 · ae15-letter
white-dwarf-14         corrected package  --page-map <map>        <-- see below
22-questions · oerth-journal-12 (corrected) · sacco-interview (MANIFESTFIXED, not FINAL)
enworld-part03 (corrected) · part04 (corrected) · part05
enworld-part06 --force · part07 --force                            <-- see below
enworld-part13a · part13b (corrected) · part13c (v2.2 corrected)
```

### Four things the recipe needs that a package inventory does not reveal

Each was found by actually running the rebuild, and each would have broken a
reconstruction attempt that relied on the inventory alone:

1. **`sacco-interview` must use the `MANIFESTFIXED` package, not the one named `FINAL`.**
   The FINAL-labelled archive is the third of four rounds and carries no clip boxes; the
   ingester rejects it with 220 problems. Filename labels are not authority.
2. **Parts VI and VII require `--force`.** Both trip the date-window duplicate guard for
   real reasons recorded at the time: the Part V/VI boundary runs backwards in displayed
   time, and Parts VII and VIII genuinely overlap. Both are documented in their ingest
   commits and in `segment_boundary_discontinuity` annotations inside the corpus itself,
   so the flag is recoverable — but only from the history, never from the packages.
3. **White Dwarf #14 requires a `--page-map` that exists in neither the package nor git.**
   Without it every provenance row reads `pp.23-24` instead of the specific page, which
   is the only difference that survived the first otherwise-successful rebuild. It is
   derivable by the method the ingest commit records: exact pixel matching of each card
   against the two preserved page images placed 16 of 19 cards (10 on p.23, 6 on p.24),
   and the three it cannot place are exactly the three stitched composites the commit
   names (q03 spanning p.23's column break, q14 and q15 on p.24), whose assignment the
   commit states. Reconstructed that way, the rebuild matches canonical exactly.
4. **Two packages nest their payload under an inner directory** rather than at the
   archive root, so the package path is not the unpack path.

## Audit outcome: three categories

**1. Recoverable now (present in the working container).** The canonical database, both
staged evidence directories, all unpacked packages and every derived artefact. This
category is real but worthless for preservation, since it disappears with the container.

**2. Recoverable from repository + held packages — the whole corpus.** Demonstrated by
the end-to-end rebuild above: all ten tables identical and a byte-identical 2,106-file
evidence tree. This includes the four recipe details in the previous section, each of
which is recoverable from git history or from a documented derivation, though none from
the packages alone.

**3. Currently missing or unproven — nothing that blocks reconstruction.** The only input
not held as a file anywhere is the White Dwarf #14 page map, and it was reconstructed
from held artefacts during this audit and shown to close the gap exactly. The passphrase
is deliberately absent and must stay so.

### Two operational findings from the audit

- **The canonical staged evidence tree is fragmented across two directories.** 1,899 files
  sit in one and the 207 Part XIII-C files in another, because a different path was passed
  for the last ingest. All 2,106 assets verify against the corpus across their union, and
  no single directory holds them all. The rebuild produces one complete tree, so the
  rebuilt layout is cleaner than the incrementally accumulated one.
- **Correction to earlier reporting: "build gate strict … accepted / blocked" never
  verified that asset files exist.** The build takes the evidence directory as a named
  `--evidence-dir` flag; it was being passed positionally, so that stage never ran and the
  gate reported only the acceptance gate and the content hash. Those results stand as far
  as they go, but they were not an asset round-trip. Verified directly instead: all 2,106
  assets present and hash-correct for the canonical corpus across the union of its two
  directories, and for the rebuilt corpus in its single directory.

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
