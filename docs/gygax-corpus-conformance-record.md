# Gygax Corpus — Retrospective Conformance Record

**Audit date:** 4 September 2026
**Rules applied:** [`gygax-corpus-evidence-ingestion-rules.md`](./gygax-corpus-evidence-ingestion-rules.md) (v1.3, 3 September 2026) · **Schema v2.1**
**Operational baseline:** `9dc1292` (Gamasutra). First post-baseline expansion: `4b868f6` (Wargamer's Digest 1974).
**Audit tool:** `scripts/gygax-v2-conformance-audit.mjs` (read-only; re-runnable)

## Purpose

Sources ingested before Rules v1.2 were written down are **not** rewritten and **not**
re-ingested merely because the rules now exist. This record answers, per documentary
object, the governing question:

> Is this already represented correctly under the frozen v2 model and the current
> Evidence Ingestion Rules?

Conformant objects are certified and left alone. Non-conformant objects are fixed at
source and re-run through the normal gate. This record does not claim that earlier
ingestions *happened under* v1.2 — only whether they *conform to* it now.

## Result

| # | Source | Status | Open items |
|---|---|---|---|
| 1 | ENWorld Q&A (Stage A) | **Conformant** *(reconstructions regularised 2026-09-03)* | completeness `unknown` corpus-wide (§12 review) |
| 2 | Dragonsfoot batch 01 | **Conformant** *(reconstructions regularised 2026-09-03)* | completeness `unknown` (§12 review) |
| 3 | Ward "Greyhawk #2" | **Conformant** *(defect fixed, see below)* | — |
| 4 | GameSpy Interview Part I | **Conformant** *(debt resolved 2026-09-03)* | — |
| 5 | Cyclopeatron | **Conformant** | — |
| 6 | Gamasutra 2002 | **Conformant** | 6 stitched cards accepted; whitespace seams are presentation refinement, not evidentiary defect |
| 7 | Wargamer's Digest 1974 | **Conformant**, pending review | 2 multi-asset units (§5) — confirmed correct: long testimony over substantial pages |
| 8 | A&E #15 Gygax letter | **Conformant**, pending review | 1 multi-asset unit (§5) — confirmed correct: 3-page letter. Corpus's 2nd verified transcript, 1st from primary page images |
| 9 | White Dwarf #14 interview | **Conformant** | 19 verified transcripts + corpus's **first verified `unit_context`**; 3 stitched cards accepted. Evidence-card defect caught pre-ingestion and corrected upstream |
| 10 | 22 Questions on Tharizdun | **Conformant** | 22 Kasparian questions separated upstream after this gate refused the first package; 8 stitched cards accepted; no date value recorded (§ below). completeness `unknown` (§12 review) |
| 11 | Oerth Journal #12 (Stormberg) | **Conformant** | First source using **four** context kinds (question / editorial_framing / headnote / caption) and the first with **unattributed** context; 8 reconstructions accepted; game-text sections deliberately excluded. 4 multi-asset units (§5) — confirmed correct: context cards, not testimony continuation. completeness `unknown` (§12 review) |

**Corpus-wide checks: all pass.** Integrity check; FTS sync and queryability for
`units_fts` / `context_fts` / `discovery_fts`; transcript structural purity (§7); no
context text indexed as speaker testimony (§8); all 679 staged evidence files hash
to their database records (§15).

**Summary: 11 objects · 0 defects · 0 grandfathered debt items · 7 review items.**

## Defect found and fixed

**Ward "Greyhawk #2" had no coverage segment (§3).** Every documentary object must
state what survives. Fixed at source in `scripts/gygax-v2-ingest-ward-greyhawk2.mjs`
(not by patching the derived database), then applied by a full pipeline rebuild. The
segment records completeness **as preserved** and explicitly declines to equate that
with historical completeness, per §3.

## Reproducibility verification

The fix was applied by rebuilding the entire corpus from the v1 source plus all seven
evidence packages, in ingestion order. The rebuilt corpus was compared against the
previous canonical database on id-independent content hashes:

- **Identical:** testimony units, evidence assets, provenance rows, unit context,
  discovery text, documentary objects.
- **Sole difference:** the added Ward coverage segment (18 → 19 coverage rows).

This confirms the ingestion pipeline is deterministic and that the corpus is
genuinely reproducible from its packages, not only incrementally accumulated. The
sha256-keyed reconstruction acceptance registry remained valid throughout, since
asset hashes were unchanged. Post-rebuild: schema tests all pass; build gate
`accepted 7 · provisional 195 · blocked 0`; 607 assets round-trip verified.

## Known debt (tracked, not blocking)

1. ~~**GameSpy paired assets → continuous stitched cards.**~~ **Resolved 3 September
   2026.** A reconciliation package supplied seven continuous stitched cards for the
   compact exchanges split by pagination (q06, q08, q11, q15, q20, q24, q27). Applied
   through the reproducible pipeline as a `--reconciliation` overlay on the GameSpy
   ingester, so the superseded pairing is never produced rather than deleted after the
   fact. All seven joins were independently eyes-on verified and accepted. GameSpy:
   35 → 28 assets (21 single-source crops + 7 stitched), provenance unchanged at 35
   (each stitched card retains ordered provenance to both contributing pages).
   Testimony-unit identity and historical metadata were not touched — units, context,
   discovery and coverage compared IDENTICAL before/after.
2. **Provisional reconstructions — ENWorld resolved 3 September 2026; 9 remain.**
   All 186 grandfathered ENWorld Stage A reconstructions were resolved upstream from
   the preserved PDFs and applied as a `--regularization` overlay on the ENWorld
   ingester (fail-closed on the old asset SHA-256; every key matched exactly one
   asset). 160 were genuine compact posts split by pagination and are now accepted
   continuous stitched cards; **26 were not genuine cross-page units at all** — their
   ranges had been enlarged by preservation/navigation/quoted-text matching — and are
   now ordinary single-source crops, gate-exempt. 33 page ranges were corrected and 38
   extraneous provenance rows removed (821 → 783). Reconstructions 209 → 183;
   accepted 14 → 174; provisional 195 → **9 (Dragonsfoot only)**.

   Independent verification beyond the preparer's recorded eyes-on: the author header
   was confirmed as Gygax's `Col_Pladoh` on **all 186** replacements (covering the
   wrong-poster failure class the package itself disclosed and corrected at Part I
   locator 204), the four same-minute-timestamp risk cases were inspected directly,
   and a cross-part sample of joins was inspected. The remaining stitched joins rest
   on the preparer's recorded eyes-on.

   **Dragonsfoot resolved 3 September 2026.** All 9 were rebuilt from the preserved
   19-page slice and remain correctly stitched compact posts; provenance unchanged at
   18 ordered portions (no net row change). Independently verified: `Col_Pladoh`
   author header and timestamp matching the manifest on every card, each post complete
   through its sign-off, joins continuous. **Reconstruction gate now reads
   accepted 183 · provisional 0 · blocked 0.**

   > **Reconstruction debt is cleared. The corpus is NOT thereby fully regularised.**
   > Evidentiary regularisation has more than one axis, and the reconstruction count
   > must not become a proxy for overall evidentiary cleanliness. Embedded
   > quote/context attribution (below) remains open and is the more consequential axis.
3. **Embedded quote/context attribution — ENWorld RESOLVED 3 September 2026; Dragonsfoot open.**
   ENWorld Stage A is done: 485 affected units separated into a Gygax-reply discovery
   extraction plus **645 quoted prompts**, each carrying a structural
   `unit_context` row typed `quoted_question` (used in its **functional** sense —
   the prompt Gygax selected and answered, not a punctuation test — so **no schema
   amendment was required**). Speaker populated for the 485 segments the source names
   (186 forum-handle person records created, handles preserved exactly, no real-world
   identity inferred, no merging) and left **NULL for the 160** the source does not
   name. Context text stays empty/untranscribed; quoted wording lives in clearly
   labelled discovery rows. Applied fail-closed on the triple key
   (part, printable-view position, header-inclusive baseline SHA-256): **485/485**.

   Adversarial retrieval purity, measured with valid probes: **643/643** quoted
   segments matched a quoted-prompt row, **0 leaked into Gygax transcript FTS**, and
   **0 leaked into a Gygax-reply discovery row**; **482/482** Gygax reply phrases
   remained discoverable. The 47 unaffected units and all other objects' context rows
   were untouched.

   **Dragonsfoot resolved 3 September 2026.** 13 of 14 units, **28 functional
   quoted_question segments**, curated source-by-source rather than by applying the
   ENWorld layout rule: nested prior-Gygax quotations excluded from the questioner's
   searchable wording (seq 3, 7, 16); malformed `Col_Pladoh wrote:` markup resolved
   against earlier posts in the same preserved thread (seq 17 gideon_thorne, seq 18
   Bregh); and seq 28 split three ways as Lothar TVNI → Lenard Lakofka → Lothar TVNI
   so Lakofka's words are not attributed to Lothar. Applied fail-closed on sequence +
   baseline discovery SHA-256 + **current evidence-asset SHA-256** (13/13), the asset
   key proving it could not be applied to the superseded cards.

   Adversarial purity, both forums, probes validated: ENWorld **643/643 live, 0
   leaks**; Dragonsfoot **28/28 live, 0 leaks**; Gygax reply phrases **482/482** and
   **13/13** still discoverable. Sequence 1 and all other objects untouched.

4. **Discovery-text NUL defect — FIXED 3 September 2026.** A failed PDF glyph
   extracted as U+0000; SQLite binds TEXT as NUL-terminated, so the remainder was
   silently truncated. One Stage A record was affected (Part II locator 101),
   losing **346 characters including an entire quoted prompt**. The ENWorld ingester
   now sanitises U+0000 to U+FFFD before insertion — preserving every surviving
   character without guessing the failed glyph. Found only because a fail-closed
   baseline hash refused to match.

<details><summary>Original finding (superseded by the resolution above)</summary>

   Another poster's words are carried inside units attributed to Gygax: 432 ENWorld
   Stage A units contain explicit quoted prompts, 377 of them with another person's
   words embedded in the staging `gygax_text`; 13 of 14 Dragonsfoot units carry
   `X wrote:` quoted context, 4 with nested quotation. 445 candidate units.

   Current containment, measured: the quoted wording sits in the unit-scoped
   **discovery** layer, which has no speaker separation, so a discovery search returns
   it against a Gygax unit. Probes for phrases demonstrably belonging to other posters
   ("Christopher Lee" — 3RD21ST; "Mississauga" — Bregh; "Marine Corps Ball" —
   KewlMarine32) each return a Dragonsfoot Gygax unit in discovery while returning
   **0 hits in Gygax transcript FTS**. Transcript purity therefore holds; the exposure
   is retrieval attribution, and it matters for search and any downstream synthesis.
   Boundary decisions between Gygax's newly authored reply and quoted material are a
   historical judgement, not a code decision.
</details>

6. **ENWorld Part III screenshot recapture — OPEN, blocked on capture.**
   *(Last remaining pre-operational item.)* The recapture material verified so far is
   **not sufficient** to package as a Part III reconciliation, and must not be applied
   as a partial replacement presented as a completed one.

   Verified upstream (material held outside this repo, not independently checkable
   here): 12 unique screenshots, IMG_1534–IMG_1546 with IMG_1538 absent; IMG_1545_2
   and IMG_1546_2 are byte-for-byte duplicates of IMG_1545/IMG_1546 and add no
   coverage. The run reaches roughly post **#992 → #1020**, ending on thread page 102.

   Corroborating detail from the corpus side: the existing Part III coverage row
   records the old preservation as *"Selected screenshots around ENWorld pages
   103-110 plus manual transcriptions; remainder absent"*. The recapture therefore
   currently stops **immediately before** the old segment begins — there is **no
   overlap at all** with the material it is meant to supersede. With no overlap,
   nothing can yet be classified as superseded versus newly recovered, which is a
   stronger blocker than mere incompleteness.

   **Needed:** a continuous capture from thread page 103 / post #1021 onward, past the
   old segment's endpoint around #1100. Then the standard treatment applies — preserve
   and hash, establish exact coverage, compare against the old Part III preservation,
   separate superseded from newly recovered, prepare the evidence/update package,
   verify eyes-on, and only then hand it to ingestion.

## Schema amendment v2.1 — source-scoped pseudonymous identity

Applied 3 September 2026 under Rules §19, driven by evidence rather than preference.

The Dragonsfoot attribution pass produced the handles `Bregh` and `gideon_thorne`,
already attested as ENWorld handles. Under `UNIQUE(name)` the corpus could only merge
them (asserting identical strings on independent forums are the same human), rename
them (falsifying the source label), or discard known attribution — each a semantic
loss, so the architecture reopened narrowly.

`persons` gains `identity_scope`: NULL for a globally identified historical person,
otherwise the source family in which a pseudonymous handle is attested. `UNIQUE(name)`
is replaced by two partial unique indexes, because SQLite treats NULLs as distinct and
a plain `UNIQUE(name, identity_scope)` would silently permit duplicate global persons.

Result: 200 persons — 5 global (Gygax, Ward, Smith, Rausch, Lenard Lakofka), 186
scoped `ENWorld Q&A`, 9 scoped `Dragonsfoot`. `Bregh` and `gideon_thorne` each exist
as two distinct source identities with **identical, unqualified names**. Existing
ENWorld handle names were **not** renamed. Twelve schema tests cover the new
constraint.

Scope records only that sameness across sources has **not been established**. It is
not a claim that two different people existed; if evidence later establishes identity,
that is an explicit reconciliation, never inferred from matching strings.

## Failure class found: ordinary crops are gate-exempt but not self-verifying

White Dwarf #14 (4 September 2026) exposed a control gap. Four ordinary crops sliced
the initial glyph of every line and one stitched card clipped its final word. Ordinary
single-source crops are deliberately exempt from the reconstruction acceptance gate
(§6), so **no automated control would have caught this**: byte hashes prove the
prepared bytes are unchanged, not that a crop contains all of the source text — the
crop-level analogue of the Ward lesson about stitching.

Caught by pre-ingestion review, corrected upstream from the source pages, and
re-verified: the five corrected cards changed and the other fourteen were byte-
identical, with transcripts, questions and unit identities unchanged. Practical rule:
derived crop cards need eyes-on review before ingestion even when gate-exempt.

## A source with no date value at all: 22 Questions on Tharizdun

The questionnaire (4 September 2026) is the first object ingested with **no date value
in any queryable column** — object and all 22 units carry `date_precision='unknown'`
and NULL date values.

What is known is a *terminus ante quem*: an Internet Archive capture attests the
Greyhawk Codex page by 2000-10-13. What is not known is when Gygax answered. The
schema has no field that keeps that distinction — writing 2000-10-13 into
`date_to_value` would make the bound indistinguishable from a dated endpoint to every
query and every display. The bound is therefore recorded as prose: object `notes`, the
unit `source_locator`s, and a `date_limitation` annotation carrying the archived URL.

The two republication dates that *are* precisely known — Bannock's 2016-06-09
neuronphaser.com publication and the 2018-03-31 PDF capture — are held as provenance
(object citation, `evidence_sources.capture_date_value`), never as testimony dates.
Consistent with §12: precision is recorded, never manufactured. The cost is that the
bound is not queryable; that is a known schema gap, recorded rather than amended.

## Attribution gate refusing a package: the 22 Questions first cut

The first cleaned 22 Questions package passed integrity, crop completeness, stitch
continuity, date handling and transcript status — and was still refused, because all
22 of Michael Kasparian's questions were merged into Gygax-scoped `discovery_text`.
That is the same §8 defect regularised out of ENWorld (645 prompts) and Dragonsfoot
(28) days earlier, and it would have made this the only source where interviewer
wording sits inside Gygax's testimony. Q15 made the harm concrete: the parenthetical
speculations "a Suel Mage of Power, an Elven arch-mage…" are Kasparian's, while
Gygax's answer opens "Once more, I have no file of data dealing with Tsojcanth."

Corrected upstream, not in code. The replacement package supplies 22 separate
`quoted_question` segments, and the split was verified **lossless**: question + newline
+ answer reproduces the earlier merged text byte-for-byte in all 22 units, and every
evidence asset SHA-256 is unchanged, so the pre-ingestion eyes-on acceptance of the
cards carried over without re-review. Two vocabulary values outside the frozen schema
(`republished_text_attributed_to_gygax`; `historical_web_republication` as a family
name) and a `plaintext_sha256` field that in fact hashed the PNG were corrected in the
same pass.

Q19 is a source-formatting exception worth recording: the republication sets both
question and answer bold, where the other 21 answers carry a blockquote rule. The
split follows the visible source boundary — the prefixed three-line question ends
"she develop Tsojcanthʼs research?" — not the styling.

## The source that states its own attribution key: Oerth Journal #12

Stormberg's article (4 September 2026) prints its convention in the headnote: *"Text
in bold indicates my line of questioning and the italic Author's Notes identify my
observations and comments on Gary's answers."* The ingestion follows that sentence
rather than an inference — 31 `interviewer_question`, 6 [PJS] notes and 1 transition as
`editorial_framing`, all Stormberg's, none of it Gygax testimony.

It is the first source to use **four** context kinds, and the first with **unattributed
context**: the three illustration captions are credited to nobody in the issue, so their
`unit_context.speaker_id` is NULL rather than assigned to Stormberg or Gygax — the same
treatment as the 160 unnamed ENWorld quote segments. The package's
`Oerth Journal (unattributed editorial caption)` label is carried as a provenance
locator, not as a person row: the corpus does not invent an author to fill a column.

Three representation decisions worth recording, all made because the alternative would
have asserted something the source does not:

- **No unit numbers.** The article prints every question as a bare `Q:`. The Q1..Q31
  keys are preparation sequence, so `unit_number` is NULL and `unit_number_status` is
  `unknown`; order lives in `sequence_in_object`, which §5 defines as an ordering key
  and not a historical claim.
- **Publication dated, testimony not.** Unlike 22 Questions, the publication dates ARE
  known — Spring 2001 preview, August 2001 revision, July 2002 recompilation — so the
  object carries `2001`–`2002-07` at year precision. The underlying emails are undated
  and every unit keeps `date_value` NULL.
- **Family typed by what it is.** The package declared `source_kind: questionnaire`.
  Oerth Journal is a periodical that happens to carry a questionnaire, so the declared
  kind was placed on the *object* (`object_type='questionnaire'`) and the family typed
  `periodical`, matching White Dwarf and A&E. Typing the fanzine itself a questionnaire
  would have misdescribed every future article from it.

**Excluded by design:** the Dorgha Torgu and Greyhawk Gods / Rentaq game-text sections.
The issue calls the Greyhawk Gods sourcebook a collaboration without allocating
authorship, so classifying it as Gygax testimony would infer what the source withholds.
Recorded as a coverage segment; preserved unchanged in the source PDF.

**Q31 inline interpolation.** Gygax's printed answer contains Stormberg's bracketed
identification "[the obscure clue in module C1 by Harold Johnson and Jeff R. Leason]".
It cannot be separated without departing from the source, so it stays verbatim in the
discovery text with a unit annotation naming it as Stormberg's and giving its character
offsets. The frozen schema has no ordered mixed-speaker discovery segment; recorded, not
amended.

## Observed limitation: OCR reconciliation over-reaches on units carrying context cards

Oerth Journal #12 produced four `INSPECT` warnings (Q2, Q8, Q15, Q23). All four trace to
`sourceTextForUnit()` concatenating *every* discovery row bound to a unit — including
caption and transition context whose evidence lives on a separate card or outside the
crop — and then looking for that text in the testimony card's OCR, where it correctly is
not. Re-reconciled against only the text actually printed on each card, the same four
read 95.2% / 99.5% / 99.7% / 97.6% coverage with **zero** missing runs.

No evidence was dropped; the control's scope is simply wider than the asset it inspects.
Left as-is because OCR reconciliation is warning-only by design and never certifies
anything (§6) — but any future source carrying context cards will raise the same
false signal, so the warning must be read with that in mind rather than treated as an
omission finding.

## Not auditable by code (historical judgement)

Recorded so these are not mistaken for certified:

- §4 whether a preserved block really is one historical testimony unit
- §11 whether `discourse_mode` reflects the passage rather than filling a field
- §2 inclusion/exclusion of authored game material as testimony
- §20 whether external verification was actually performed for pre-baseline sources
  (formally recorded only from Wargamer's Digest onward)

## Prepared but not yet in the operational corpus

Verified absent from the corpus by inventory; these go through the full
one-source-at-a-time process (§16) when their packages are ready: **Kyngdoms / Sacco
interview**, **Alarums & Excursions July 1975 letter**, **Ward "Gary Gygax Things"**,
and the **ENWorld Page 39 update**. ENWorld **Part III** stays behind until a
continuous recapture from thread page 103 / post #1021 onward is available.

---

Re-run the audit at any time with:

```
node --experimental-sqlite scripts/gygax-v2-conformance-audit.mjs <v2.sqlite> --evidence-dir <dir>
```

It exits non-zero on any defect or corpus-wide failure.
