# Gygax Corpus — Publication Architecture

**Status:** agreed direction, 5 September 2026, at corpus commit `188ee0a`
**Governs:** how the public website relates to the corpus, and how future material reaches it

## The principle

The website is a **presentation layer over the corpus**, never the corpus itself. Publishing
must not freeze the data model, and the public site must never become a place where
historical data is edited.

Everything continues to travel one way:

```
source / evidence package
  → ingest or reconciliation (upstream corrections only)
  → canonical rebuild
  → validation gates
  → publication export
  → website deploy
```

A correction discovered on the public site is corrected **upstream in the evidence
package** and the site regenerated. That is the same rule the corpus has followed
throughout — the derived database is never patched by hand — extended one step further to
the derived website.

## Three layers, kept distinct

| layer | what it is | authority |
|---|---|---|
| **Research repository** | ingest machinery, frozen schema, acceptance registry, rebuild script | authoritative working system |
| **Canonical corpus** | the SQLite a rebuild produces | derived, reproducible, never hand-edited |
| **Publication** | a stable export the site consumes | derived from a *named corpus commit* |

## The gap this record exists to name

**There is currently no publication layer.** `scripts/build-gygax-v2.mjs` encrypts and
ships the whole internal SQLite (`corpus.enc`) plus every evidence asset. A website
consuming that would be reading the **internal table layout directly** — `testimony_units`,
`unit_context`, `discovery_text`, `evidence_sources` and the rest — which is exactly the
coupling to avoid. Every future schema migration would then force a website rewrite.

So the publication schema is a **missing layer, not a formalisation of an existing one**.
Nothing is broken today, because nothing is deployed: `static/research/gygax/v2` does not
exist. The coupling has simply not been exercised yet, and this is the moment to prevent
it rather than discover it after launch.

## What the publication layer must provide

A stable contract, versioned independently of the internal schema, exposing at least:

- testimony units, with their dates and date precision as recorded;
- prompts and contexts, keeping the **canonical antecedent attribution** distinct from
  **quote-label linkage evidence** — the distinction the whole EN World reconciliation
  exists to draw, which must survive into public view rather than being flattened;
- people as **attested participant identifiers**, per the `Jodjod` rule: a person row may
  legitimately hold zero canonical prompts;
- sources, documentary objects and coverage — including coverage that is `partial` or
  explicitly unresolved, stated as such;
- evidence cards referenced by **stable immutable IDs** (sha256 is already the natural
  key, and every asset already carries one);
- provenance, annotations, and search fields.

Two properties matter more than the field list:

1. **Uncertainty must survive export.** The corpus is careful to distinguish verified from
   untranscribed, antecedent-based from label-derived, complete coverage from partial, and
   attested handles from personal identities. A publication schema that flattens any of
   those would misrepresent the evidence more damagingly than a missing feature would.
   The 223 unresolved Stage A attributions are the test case: they must not read as though
   they met the antecedent standard.
2. **A reader must be able to walk back.** From a public quotation to its testimony unit,
   and from there to the evidence card and its provenance locator. That path is what makes
   the corpus checkable rather than merely readable.

## Deployment properties

- generated from a **known corpus commit and content hash**, not from a working directory;
- **evidence assets immutable**, addressed by stable IDs, so a republished page keeps
  pointing at the same bytes;
- the site exposes a **corpus version or build identifier** — not necessarily prominent,
  but present, so any public page can be tied to the exact corpus state that produced it.
  This becomes valuable as soon as corrections and new material start arriving after
  launch, which they will;
- the plaintext SQLite and evidence originals stay gitignored; only encrypted artefacts
  are deployable; the passphrase never enters the repository or any deployed artefact.

## Why this makes later work routine

With the layers separated, each kind of future change touches one place:

- a newly found interview is **another evidence package** through the existing pipeline;
- a new annotation kind is **a schema migration**, invisible to the site until exported;
- a better search or relationship view is **a website feature**, needing no re-ingestion;
- a correction is **an upstream package**, followed by a rebuild and a regenerated site.

None of those requires rebuilding the preservation method, and none should require
reopening EN World.

## Sequencing note

The three queued sources — A&E July 1975, Ward's "Gary Gygax Things", ENWorld Page 39 —
are ordinary expansion and do not depend on this. They can be ingested before or after the
publication layer exists. External preservation remains independent of both, and remains
the only unresolved preservation task.
