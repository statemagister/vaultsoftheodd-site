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
| 1 | ENWorld Q&A (Stage A + **Parts III–VII, XIII complete**) | **Conformant** *(reconstructions regularised 2026-09-03; Parts III–VII and XIII-A/B/C added 2026-09-04/05; Part IV identity reconciled 2026-09-05)* | 532 → **1,885** units. Part XIII is **complete**: A+B+C held, P13:post0001–1594, **666 Gygax posts, zero uncovered**. Part IV `Flekor`→`Flexor` **resolved**. **Stage A attributions still need reconciliation**, including the open `coz`/`BOZ` case (§ below). completeness `unknown` corpus-wide (§12 review) |
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
| 12 | Sacco / Dungeons.it "Ultimate Interview" | **Conformant** | Largest source in the corpus: **60** Gygax units (50 replies + his own introduction + 9 interstitials); 35 reconstructions over **50 joins** accepted; dated only where the source evidences a year. 10 multi-asset units (§5) — confirmed correct: context cards. completeness `unknown` (§12 review) |

**Corpus-wide checks: all pass.** Integrity check; FTS sync and queryability for
`units_fts` / `context_fts` / `discovery_fts`; transcript structural purity (§7); no
context text indexed as speaker testimony (§8); all 2,106 staged evidence files hash
to their database records (§15).

**Summary: 12 objects · 0 defects · 0 grandfathered debt items · 9 review items.**

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

## Four gate rounds on one source: Sacco / Dungeons.it

The "Ultimate Interview" (4 September 2026) is the largest source in the corpus — 60
Gygax units — and took four packages to pass. Recording the sequence, because each
round failed on a different axis and none of them was the evidence itself:

1. **Metadata and attribution.** Family kind `website` is outside the frozen
   vocabulary; the page-one headnote merged The Kyngdoms' third-person republisher
   preface ("presented here with **his** permission") into Sacco's first-person
   introduction under one row attributed to Sacco, dropping the heading between them;
   two printed headings were unrepresented while nine others were carried.
2. **Dating.** All 60 units were stamped `2003`. The source contradicts that: one
   answer says "later this year, in 2003", another places a Comdex demonstration "this
   November" *before* an alpha test expected "early in 2003", so it was written before
   November 2002 — matching Gygax's own "in bits and pieces over a period of weeks".
3. **Card readability**, found upstream and rebuilt at a larger render.
4. **A manifest that described files it did not ship.** `source_portions[]` named 110
   derivative assets of which **85 did not exist**, and all 25 that did carried a
   `source_asset_sha256` matching nothing — while `clip_pdf_points`, the coordinates
   that make a card independently re-derivable, had been dropped to make room for them.

The final package fixes all four. Dating is now stronger than proposed: rather than
stamping the span on every unit, only the **two units that date themselves** carry a
year, the other 58 carry none, and `2002-2003` sits on the documentary object.

**Verification worth reusing.** The manifest-repair round changed exactly two files
(`cards/manifest.jsonl` and `SHA256SUMS.txt`); the other 107 were byte-identical to the
package already reviewed, so the card work carried over intact. The restored clip boxes
were then checked against the source rather than against the earlier package they were
said to come from — they differ from it by 1-6 pt, being new boxes cut for the
re-rendered cards — and **all 110 reproduce their card band with a zero-pixel
ink-bounding-box delta when rendered from the PDF at 3.0×**. That is a stronger
guarantee than provenance coordinates have carried anywhere else in the corpus: every
card is independently re-derivable from the preserved PDF.

**Sixty units, not fifty.** Besides the 50 replies, Gygax wrote his own introduction
and nine interstitial statements under Sacco's section headings — under "GARY GYGAX,
THE MAN" he writes "Does that mean you think I have grown up? Wrong!" Those are his
words and sit in the Gygax layer; the headings above them are context, credited to
nobody. Neither the republisher nor a printed heading is a person and the schema has no
non-person speaker, so those identifications live in provenance labels rather than in
invented `persons` rows — the same restraint applied to the Oerth Journal captions.

## Extending an object rather than creating one: ENWorld Part III

Part III (4 September 2026) is the first ingestion that **grows an object the corpus
already held**, and it closed a gap carried since v1: the Part III coverage row
described "selected screenshots around ENWorld pages 103-110 plus manual
transcriptions", while the v2 corpus in fact held **zero** Part III units. It now holds
154 Gygax posts out of the segment's 351 printable-view posts, P03:post0004 to
post0349, 6 April to 22 July 2003. The ENWorld object goes 532 → 686 units and the
coverage row was **rewritten, not added**.

The structural risk here was duplication, not attribution, and the ingester refuses
rather than guesses: it aborts unless the existing family and object are found, aborts
if any Part III unit already exists, and aborts if any held unit falls inside the
segment's date window. Verified before the run: Part II ends 2003-04-06T14:19 and this
segment opens 2003-04-06T18:29, with no overlapping text and no overlapping dates.

**Three preparations were needed, and the second two were caught by different checks.**

1. The first named family "EN World" and object "Gary Gygax Q&A" — neither matching the
   corpus. Applied literally that would have split the corpus's largest thread into a
   duplicate object. It also carried `&gt;` undecoded inside a forum handle, printable
   -view navigation furniture inside context text, and a two-quote post whose second,
   *unattributed* quote had been attributed to the first quote's author.
2. The second was correct except that one card (P03:post0164) stitched a page-44
   portion containing **no ink at all** — the post ends on page 43. A reconstruction
   that reconstructs nothing still enters the acceptance gate and still records a
   provenance row for a page that contributed nothing. Found by rendering every clip
   box and comparing ink bounding boxes: 199 of 200 matched their card band exactly and
   the 200th was blank. Corrected upstream to a single-portion crop, with the other 153
   card files left byte-identical so their verification carried over.

**Gygax's words are often non-contiguous here.** A single post may carry several quote
boxes with his replies between them — one has six. Whole-unit text matching therefore
fails legitimately; matching line by line, all 1,199 lines are verbatim in the source.
161 prompts were separated across 133 units, attributed to the handle the source names
and left with **no speaker** on the three quote-backs it does not attribute. Handles
stay source-scoped: 22 already-held ENWorld identities were reused and 33 created.

**Two control characters** (U+0000, U+0001) survived the PDF text layer as failed
glyphs in two context rows. Left raw, the NUL binds to SQLite TEXT as a terminator and
silently truncates the rest of the row — the defect that cost 346 characters at Part II
locator 101. Repaired upstream to U+FFFD, which keeps every surviving character and
guesses nothing about the failed glyph.

## Part IV, and why U+FFFD is wrong inside a handle

Part IV (4 September 2026) added 117 Gygax posts out of the segment's 267 printable-view
posts, P04:post0002 to post0265, 22 July to 9 December 2003 — continuing the same
afternoon Part III ends. The ENWorld object reaches **803** units.

The package was refused on one point, and it is worth recording because the repair was
*correct in general and wrong in this position*. Three participant handles carried
U+FFFD where the PDF text layer had failed to extract a first letter: `�rthurQ`,
`�ndrew D. Gable`, `�hyron1144`. Substituting U+FFFD is exactly right for a failed glyph
in prose — it preserves every surviving character and guesses nothing, which is why it
was the agreed repair for the Part III control characters. But a handle becomes a
`persons` row, i.e. an **identity**, and `khyron1144` also appeared INTACT elsewhere in
the same package. Ingesting as supplied would have created two identities for one person
inside a single segment.

The glyphs are legible on the evidence cards — the text layer failed, not the rendering
— so they were read there and corrected upstream. That is the corpus's own standing
principle: the preservation image is authoritative and the text layer is discovery only.
Inference would have got one wrong; `khyron1144` begins with a lowercase k, not the
capital its neighbours suggest. The Part IV ingester now fails closed on any U+FFFD in a
handle, and that check was confirmed against the superseded package before use.

## Derived ingesters inherit assertions that cannot fire

Both ENWorld segment ingesters failed their own checks on first run, and in every case
the data was clean and the assertion was wrong:

- Part III used `LIKE '%' || char(0) || '%'` to look for NUL. SQLite's `char(0)` returns
  an **empty string**, so the pattern degenerates to `'%%'` and matches every row.
- Part III's furniture check `LIKE '%Page % of %'` matched Gygax's own prose —
  "equi**ppage** a girdle **of** storm giant strength".
- Part IV, derived from Part III, inherited an assertion that exactly **two** rows carry
  U+FFFD (true of Part III, false of Part IV, whose three were corrected upstream) and an
  FTS probe on the phrase "nonintelligent undead", which is Part III text and can never
  appear in a Part IV row.

The pattern: an assertion that cannot fail and an assertion that cannot pass are the same
defect, and mechanical derivation between segments propagates both. Segment-specific
probes are now taken from the segment's own data at run time rather than hardcoded, and
text-shape checks are done in JS against the rows rather than in SQL `LIKE`.

## When the quote label and the antecedent disagree: ENWorld Part V

Part V (5 September 2026) added 97 Gygax posts of the segment's 214 printable-view
posts, P05:post0005 to post0210, 10 December 2003 to 9 February 2004. The ENWorld
object reaches **900** units.

It introduced a distinction the earlier segments never needed. A vBulletin quote-back
carries a label — *Originally Posted by X* — and the preserved antecedent post carries
its own author header. In two cases here the two disagreed:

| Antecedent | Header says | Quote label says |
|---|---|---|
| P05:post0003 | BrooklynKnight | ArthurQ |
| P05:post0050 | Darrin Drader | Whisperfoot |

The package treats the **antecedent as canonical** and keeps the label as linkage
evidence only. That is right, and it was verified from two directions rather than
accepted: the quoted words appear verbatim under the antecedent header at an earlier
timestamp in the same preservation PDF, and neither phrase appears anywhere else in the
corpus attributed to the label handle — so the alternative reading, that the label is
correct and the antecedent is a repost, has no support.

What makes the case sharp is that **both label handles are genuine ENWorld identities
already held** from other segments (ArthurQ from Part IV, Whisperfoot from Part VIII).
So this is not a phantom label. It is consistent with an account rename that the
printable view renders inconsistently between post headers and quote blocks — which
would make these two pairs candidate *identity links*. The corpus does not act on that:
§19 requires identity to be independently established, and a rendering inconsistency is
not that. The labels sit in the provenance locator so a later reconciliation can weigh
them. Attributing the prompts to the labels would have credited two prompts to the wrong
participants; treating the labels as proof of a rename would have merged identities on
no evidence. Neither was done.

**A guard caught a bug in itself.** The duplicate-segment check aborted the first run,
reporting 157 existing "Part V" units. There were none: `LIKE '%Part V%'` also matches
Part VI, VII and **VIII**. Roman-numeral labels are prefixes of one another, so the
check now matches the parenthesised label exactly. The guard failing loudly on its own
defect is the behaviour worth having; a silently permissive version would have been
worse.

## Two attribution methods, and 485 attributions that need reconciling

Establishing the Part V quote-label rule exposed a **methodological inconsistency** in
what the corpus already holds. The two regimes are not equivalent:

| Segments | Prompts | Attributed | How the participant was identified |
|---|---|---|---|
| **I, II, VIII** (Stage A) | 645 | **485** | parsed from the vBulletin quote **label** |
| **III, IV, V, VI** | 569 | 562 | the recovered **antecedent post header** |

Every one of the 485 Stage A `explicit_speaker_name` values came from a segment whose
text opens `"Originally posted by …"`. No antecedent recovery was performed for those
parts — the concept did not exist yet. Part V then showed that label and antecedent can
disagree, and that when they do the label is the weaker evidence.

So those 485 are **not** to be treated as equivalent to the later method. They need a
preparation-side reconciliation against the Parts I, II and VIII source PDFs, which the
Stage A package does not contain and which must be re-supplied. Each prompt should
acquire the same distinction used prospectively: antecedent-post speaker as canonical
where recoverable, source-native quote label retained separately, and an unresolved
antecedent left **explicitly unresolved** rather than silently inheriting the label. No
identity merging follows from a mismatch alone.

Sequence agreed: **VII → XIII → Stage A reconciliation**, so the retrospective work does
not block the remaining primary gaps.

### What not to do, established by a failure

An attempt to measure the label-vs-antecedent divergence rate by re-deriving labels from
the PDFs **failed twice**, and its intermediate numbers (33%, 100%, 57%) are artefacts
that should never be cited. The first pass collapsed newlines, so its label regex
truncated handles at the first capitalised word — "Flexor the" for *Flexor the Mighty!*
— and a 120-character look-back caught Gygax's own byline, which is why `Col_Pladoh`
kept appearing as a quote label. The second, line-structured, still missed both cases.

The decisive point is that **both runs failed their control**: neither recovered the two
known Part V mismatches. A method that cannot recover the known cases has failed before
any percentage it produces carries evidentiary weight. The reconciliation therefore
belongs in preparation, working from the rendered evidence, not in algorithmic
antecedent reconstruction inside the ingester.

## Part VI, and a boundary that runs backwards

Part VI (5 September 2026) added 105 Gygax posts of the segment's 217 printable-view
posts, P06:post0004 to post0216, 9 February to 31 March 2004. The ENWorld object reaches
**1,005** units — the first source in the corpus past a thousand.

**The date-window duplicate guard blocked the first run**, and the reason was real. Part
V's last Gygax post reads *Monday, 9th February, 2004, 10:08 PM*; Part VI's first three
read 07:42, 07:54 and 08:04 PM the same evening, although they follow it in thread
order. Both were read from their own preservation PDFs; neither is a parse error.

Duplication was excluded four ways before the guard was overridden: Gygax's 22:08 post
appears only in the Part V PDF, the 19:42 post only in the Part VI PDF, four content
anchors from Part VI appear nowhere in Part V, and no text in the package already existed
in the corpus. An earlier "the PDFs overlap" probe was a false positive — it had sampled
Part V's trailing 3,000 characters, which is shared footer furniture.

Every other boundary in this object is monotonic, so the anomaly is confined to this
join. A roughly three-hour difference in the capturing account's display timezone would
reconcile it exactly, since vBulletin renders times in the viewer's zone — but that is a
hypothesis and is recorded as one. **Consequence:** ordering within a segment is sound;
stored minute-precision times may not share a frame across this boundary. Verbatim
`date_display` and normalised `date_value` are both kept, and `sequence_in_object`
asserts nothing historical, so the question stays fully recoverable.

The guard tests a date window as a *proxy* for duplication. The proxy misfires when
segment clocks disagree — worth knowing before Part VII.

**A source markup defect, preserved rather than repaired.** vBulletin failed to parse the
quote markup on four posts, so a literal `[/QUOTE]` is rendered as visible text in the
PDF, seven times across the segment. The cards preserve what the source displays, defect
included, because the card *is* the source-native rendering. The participant wording
those broken tags enclose is classified as context, and the stray markup appears in
neither text layer. The malformed tag is in fact useful: it marks where the quoted
material ends and Gygax resumes.

## Part VII: the largest segment, and a label that was only a font

Part VII (5 September 2026) added **214** Gygax units of the segment's 491 printable-view
posts, P07:post0002 to post0491, 24 October 2004 to 20 February 2005. The ENWorld object
reaches **1,219** units and only Part XIII remains missing.

**A truncated discovery row, caught by line-level matching.** One unit (P07:post0316) had
lost text from the searchable layer. The source's own rendering is broken there — an
overlapping draw makes the text layer read *"the T h ape ofM theg genres"* — and the
discovery string had stopped mid-garble, dropping *"of the genres as were Howard and"*.
The card was correct throughout; only the search layer suffered, which on a corpus built
for searching is the layer that matters: a query for *Howard*, *Lovecraft* or *genres*
would have missed a post specifically about Gygax's literary influences. Corrected
upstream from the rendering, keeping the mangled `ap` exactly as the evidence supports
and recovering only words demonstrably present in the source. **`shape` was not
inferred**, though it is the obvious reading.

**Three of four "mismatches" were a glyph variant, not an identity question.** The package
declared four antecedent/quote-label disagreements. Checked against the source:

| String | As a post byline | As a quote label | Already held |
|---|---|---|---|
| `T. Foster` | **8×** | 4× | yes |
| `TI Foster` | **0×** | 3× | no |
| `Scott_Holst` | 1× | – | no |
| `Doomed Battalions` | **0×** | 1× | no |

`TI Foster` never appears as a byline and differs from `T. Foster` by one character — a
rendering variant of a single handle, the Part IV U+FFFD class. `Scott_Holst` /
`Doomed Battalions` are unrelated strings and a genuine disagreement. The identity
-reconciliation worklist therefore carries **one** case from this segment, not four;
counting the other three would have sent the retrospective chasing a font defect. The
package now records the two kinds in separate fields.

**Parts VII and VIII overlap in time.** Part VIII's first preserved post is 18 February
2005 23:15 while Part VII runs to 20 February 16:02, so four Gygax posts here fall after
Part VIII begins. None is duplicated — each was checked against the corpus, which already
held Part VIII. This is the **second** boundary where the date-window guard proves a poor
proxy for duplication, after Part V/VI. The guard is still worth having: both times it
stopped the ingest and both times the investigation produced a real finding.

**Also disclosed and verified:** ten source-rendered malformed `[/QUOTE]` cases, seven
needing manual antecedent reconciliation upstream; three failed first letters (U+0000,
U+0001, U+0002) restored as `I`, `D`, `H` from the rendering rather than guessed; and one
`editorial_framing` context — Henry's administrator note announcing continuation into
Part VIII — kept visible on the card but stored as framing, not as a prompt Gygax
answered.

### Three rounds of self-inflicted assertion failures

This segment's ingester failed its own checks three times, and the data was correct every
time:

1. an inherited Part VI expectation that quote labels and antecedents never disagree
   (Part VII declares four);
2. the context-type INSERT still hardcoded `quoted_question`, so the one
   `editorial_framing` row was written with the wrong type — the **only one of the three
   that was a genuine defect in the output**, and the checks caught it;
3. a locator-wording change I made broke my own `LIKE '%NOT Gygax%'` test, because the
   reworded framing label read "NOT a prompt Gygax answered".

The pattern is now established across Parts III–VII: **deriving one segment's ingester
from the last carries stale expectations, and editing output wording silently invalidates
assertions that match on it.** Both failure modes are cheap to catch and expensive to
miss, which is the argument for running the confirmations on every segment rather than
trusting a passing predecessor.

## Part XIII-A: the first batched segment

Part XIII is large enough — 1,606 printable-view posts across a 438-page PDF — to be
prepared in three operational batches. Batch A (5 September 2026) added **224** Gygax
units, P13:post0001 to post0540, 10 April to 22 June 2007. The ENWorld object reaches
**1,443** units.

The batching is an **upload boundary, never a historical one**, and the architecture
holds that line: every unit records `preservation_segment` "Part XIII" alongside
`operational_batch` "Part XIII-A", both checked at ingest, so no phantom segment can be
created. Two consequences follow, and both are now built into the ingester:

- **Coverage is PARTIAL, not complete.** The Part XIII row names only the locator range
  actually held and says B and C are outstanding. It becomes complete when C lands.
- **The duplicate guard is locator-scoped, not segment-scoped.** B and C will legitimately
  add units to a segment that already has some; a bare "does Part XIII exist" test would
  refuse them. This is the third distinct way a duplicate guard has needed rethinking —
  after the Roman-numeral prefix collision at Part V and the two date-window boundaries.

**Five label divergences, two phenomena, and the ingester now checks the package's own
split rather than re-deriving it.** Three are text-layer glyph loss where the damaged
label is a truncation of the antecedent handle itself — `nterthorn` for Winterthorn,
`canid` for Mycanid, `a dim` for Naidim — and are excluded from the identity worklist for
the same reason the Part VII `TI Foster` cases were. Two are genuine: the antecedent
header reads `Nahat Anoj` where the label reads `Jonathan Moyer`.

That pair is worth recording carefully, because **the handle is the given name reversed**:
`NahatAnoj` backwards reads `jonAtahaN`. So this is a pseudonymous handle set against a
real name, not an account rename — a stronger reconciliation candidate than anything seen
so far, and also one whose resolution touches **real-name enrichment**, which is
deliberately deferred. Nothing is merged: the antecedent stays canonical and the label is
linkage evidence in the provenance locator.

The validation improvement matters beyond this batch: rather than the ingester deciding
which divergences are glyph damage, it now **asserts that the observed set partitions
exactly into the two sets the package declares**, with no extras in either direction. The
classification is a historical judgement and belongs upstream; the ingester's job is to
confirm the data matches it.

## Part XIII-B, and a defect it exposed in Part IV

Batch B (5 September 2026) added **235** Gygax units, P13:post0543 to post1080, 25 June
to 16 October 2007. Part XIII now holds 459 units across batches A and B; coverage
remains **partial** and records the cumulative range, since rewriting it with only B's
range would have dropped A from the record of what is held.

**The largest restoration set yet, and why it was trustworthy.** This PDF's text layer is
systematically damaged where the rendering is not: it substitutes `5` for `c` and `k` for
`x`, and drops leading letters. The batch restored 18 quote labels, one discovery string
(the book title *Anubis Murders*, whose initial `A` the text layer loses), one context
opening and two antecedent timestamps — all from the rendered card, none inferred.

Restorations that rewrite a handle are the dangerous kind, because a wrong one invents or
merges an identity. These were corroborated rather than trusted: **nine land on handles
the corpus already holds while the damaged form exists nowhere**, and the rest are
confirmed by byline frequency in the source (`Marshal Lucky` 20 occurrences against 2
damaged, `Valiant` 6 against 1, `haakon1` 135). The one case running *counter* to the
`5`-for-`c` pattern — `JMac5892` against a text layer reading `JMacc892` — was settled by
the byline: `JMac5892` appears twice as a post header and never as a label, and the card
confirms it.

**A Gygax unit's own timestamp was damaged, and the gate caught it.** `ENW_P13B_219`
(P13:post1047) read `12:01 \nM`. The batch had already restored two *antecedent*
timestamps of the same shape, but this was a testimony unit's own date and was missed.
The value is `12:01 AM` on three independent grounds — the card renders it, the preceding
unit is 11:59 PM the previous day, and the date rolls over to Saturday. Corrected
upstream; all 235 cards and the source PDF stayed byte-identical, so the physical
verification carried over.

### A confirmed fragmentation in already-ingested Part IV data

The `Flekor the Mighty!` → `Flexor the Mighty!` restoration prompted a check of the
corpus, which turned out to hold **both as separate identities**: `Flexor the Mighty!`
with 16 prompts across Parts I/III/IV/V, and `Flekor the Mighty!` with 2 prompts in Part
IV. Part IV's own PDF settles it — `Flekor` appears twice and **only ever as a quote
label**, `Flexor` seven times **including as a byline**. Same handle, same document, text
layer damaged in two places.

No control-character check could have caught this: the damaged form is plausible text. A
corpus-wide scan of all 378 ENWorld-scoped handles for single-character-edit pairs found
**exactly two** candidates:

| Rare form | Prompts | Likely true form | Prompts | Segment | Status |
|---|---|---|---|---|---|
| `Flekor the Mighty!` | 2 | `Flexor the Mighty!` | 16 | Part IV | **confirmed**, correction outstanding |
| `coz` | 1 | `BOZ` | 28 | Part I | unresolved — needs the Part I source |

`coz` falls in the Stage A label-attributed set, so it cannot be settled before that
reconciliation and belongs with it. Neither is patched in the database; both are upstream
corrections.

**One deliberate asymmetry worth recording.** At `ENW_P13B_128` the card shows a *visible
gap* where the word "good" should be — it does not render at all — while the text layer
holds `g ood`. The package kept the text-layer form, preserving the participant's word in
searchable shape. That is the opposite call from the restorations above, and defensible
for the same reason they are: each follows whichever layer actually carries the evidence.
Card and context text will read differently there.

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

**Recurred on Sacco, as predicted.** Of 35 reconstructions, 34 read clean and one —
the Gygax introduction card — reported 44.4% coverage, because the control compared it
against 2,991 characters including the republisher preface, Sacco's whole introduction
and two headings, all of which live on separate cards. Scoped to the 1,377 characters
actually printed on that card: **95.6% coverage, zero missing runs.** Two sources in a
row now, so the fix is worth making when convenient: scope the reconciliation to the
discovery rows whose evidence is that asset.

## Not auditable by code (historical judgement)

Recorded so these are not mistaken for certified:

- §4 whether a preserved block really is one historical testimony unit
- §11 whether `discourse_mode` reflects the passage rather than filling a field
- §2 inclusion/exclusion of authored game material as testimony
- §20 whether external verification was actually performed for pre-baseline sources
  (formally recorded only from Wargamer's Digest onward)

## Prepared but not yet in the operational corpus

Verified absent from the corpus by inventory; these go through the full
one-source-at-a-time process (§16) when their packages are ready:
**Alarums & Excursions July 1975 letter**, **Ward "Gary Gygax Things"**,
and the **ENWorld Page 39 update**. ENWorld **Parts III–VII are complete** and
**Part XIII is in progress** — batch A ingested 5 September 2026, with **XIII-B and
XIII-C** still to come.

---

Re-run the audit at any time with:

```
node --experimental-sqlite scripts/gygax-v2-conformance-audit.mjs <v2.sqlite> --evidence-dir <dir>
```

It exits non-zero on any defect or corpus-wide failure.

## Part XIII-C: the segment closes, and the label rule is sharpened

Part XIII-C added **207 units** (sequence 1679–1885), taking the ENWorld object to
**1,885** and closing the Part XIII preservation segment. Coverage moved from
`partial` to **`complete`** over `P13:post0001`–`P13:post1594`.

**Coverage was verified independently of the package, and without ordinals.** A first
attempt numbered posts from their header lines, recovered 1,598 of the declared 1,606,
and therefore drifted; its position-level output (141 "missing", 142 "extra") was
discarded as an artefact of that drift rather than reported. Completeness is a question
about sets, not order, so the second attempt matched on `(byline, timestamp)`:

- **665** `Col_Pladoh` post headers parse from the source PDF
- **459** already held from XIII-A+B, **207** supplied by XIII-C → **666**
- **zero** source posts uncovered; nothing by Gygax after `P13:post1594`

The single held post that matches no source header is
`Saturday, 13th October, 2007, 12:01 AM` — the XIII-B unit whose header is damaged in
the text layer and was restored from the rendered card. Its absence from the parsed set
is caused by exactly the damage that restoration repaired, so this independently
corroborates that earlier correction.

### The label rule, sharpened

The first XIII-C package declared **19** antecedent/quote-label divergences and
classified all of them as damage to the **rendered** quote label. Reading the labels off
the cards showed that held for only twelve. In the other seven the card renders the
handle **complete and identical to the antecedent**, and the PDF text layer alone had
failed:

| unit | antecedent | first declared as | card actually renders |
|---|---|---|---|
| 010 | Prince of Happiness | `Prince of \rappiness` | Prince of Happiness |
| 011 | rossik | `rossi` | rossik |
| 014 | Raven Crowking | `Raven Crow` | Raven Crowking |
| 038 | T. Foster | `T<FFFD> Foster` | T. Foster |
| 111 | Roland55 | `Roland<FFFD>` | Roland55 |
| 139 | Brace Cormaeril | `Bra` | Brace Cormaeril |
| 175 | FATDRAGONGAMES | `F<FFFD>TDRAGONGAMES` | FATDRAGONGAMES |

The field named `rendered_quote_label_fragment` in fact held **text-layer output**: 14 of
the 19 matched the text layer exactly or up to whitespace and marker normalisation, and
the remaining 5 were that same extraction truncated at the first failed glyph. Ingesting
as declared would have made the corpus assert, in a provenance locator, that a label
"reads `Bra`" when the card plainly reads `Brace Cormaeril`.

Corrected upstream, the package now separates **7 restorations** from **12 genuine
rendering-damage** cases, with **0** identity disagreements, and keeps the text-layer
fragments as audit metadata. After ingestion exactly **12** provenance rows carry a
quote-label mismatch note; the seven restored handles carry clean attributions.

**The evidence itself was never in question** — across all three XIII-C packages the 207
card PNGs, the source PDF and the 24 review sheets are byte-identical, and all 262
portions re-render from `clip_pdf_points` at 2.0× pixel-identically to their cards.

### Two further defects, and the check gaps that hid them

Running the verbatim control — which had not been run on the first package — surfaced
two more, both predating the label correction:

- **`ENW_P13C_086`** carried `?ttu Island in ?laska` (U+FFFD) where the card renders
  **Attu Island in Alaska** plainly. Not cosmetic: context text reaches `discovery_fts`,
  so a search for "Attu" would have missed the exchange while Gygax's own reply in the
  *same unit* ("Attu and Kiska") matched. Both now return one hit each.
- **`ENW_P13C_120`** recorded a discovery line matching neither the sorted text layer nor
  the card. It was **not** a hand reordering as first characterised — it was the *no-sort*
  layout extraction, a legitimate mode, but not the one the control compared against. The
  corrected line preserves reading order across the break and infers no word; the card is
  genuinely damaged there (`la  r    elicited`), and the unreadable word was left alone.

Three check gaps were closed in the XIII-C ingester as a result:

1. **U+FFFD was tested in handles and Gygax discovery but never in context prose.**
2. **Control characters were tested on `text` columns but never on `source_locator`** —
   the first package's raw U+000D would have gone into a provenance locator unchallenged.
3. **The inherited date-window duplicate guard is unsound for this thread** and is no
   longer fatal: Parts VII and VIII genuinely overlap Part XIII in time, so a unit inside
   the window may be legitimately concurrent. The printable-view locator guard is the real
   test and stays fatal.

Counts in the ingester are now routed through a single `EXPECT` block, after several
earlier ingesters inherited stale constants from the batch they were copied from.

### Result

`INGEST OK` first run, **21/21 confirmations**. +207 units, +206 contexts, +413 discovery
rows, +207 assets, +262 provenance rows, +22 new handles (30 reused), +6 annotations,
0 new objects or families. 55 stitched cards accepted eyes-on against the six join review
sheets. Audit **12 objects · 0 defects**; build gate strict **accepted 605 · provisional 0
· blocked 0**; an independent re-ingest from the pre-XIII-C snapshot reproduced content
hash `3e9d2e2d…` over 15,837 rows.

Corpus: **12 objects · 2,079 units · 2,423 context rows · 2,106 assets · 453 persons ·
80 annotations**. The primary ENWorld preservation run is closed.


## Part IV identity reconciliation: Flekor → Flexor

Two Part IV prompts (`ENW_P04_095`, `ENW_P04_096`) were attributed to
`Flekor the Mighty!`, a handle that existed nowhere else in the corpus, beside
`Flexor the Mighty!` with 25 prompts. Both were corrected upstream to `Flexor`.

**Verified against the rendering before ingestion, not accepted on assertion.** Across
the whole Part IV source text layer, `Flekor` occurs exactly twice and only ever inside
`Originally Posted by`; `Flexor the Mighty!` occurs seven times including three post
bylines. Both cards were then rendered at 9× and **both read `Flexor the Mighty!`
intact**. This is the same `k`-for-`x` text-layer substitution Part XIII-B documented in
this PDF family, so the change is a restoration from the rendering, in line with the rule
applied throughout Part XIII.

**Applied by rebuild, not by patching.** Because the corpus had already been shown
reproducible, the correction was made by swapping the Part IV package and rebuilding the
whole corpus from held artefacts, rather than editing the derived database. The rebuilt
corpus differs from its predecessor in exactly the expected places and nowhere else:

- `persons` 453 → **452** — `Flekor the Mighty!` no longer exists;
- two `discovery_text` provenance locators renamed from `Flekor` to `Flexor`;
- the two prompts consolidated: `Flexor the Mighty!` 25 → **27**;
- `Flekor` now occurs **zero** times anywhere in the corpus;
- every other table byte-for-byte identical: units, context, assets, provenance,
  coverage, annotations, objects, families.

The package changed only metadata — all 117 cards and the source PDF are byte-identical
to the superseded Part IV package.

A side effect worth recording: the rebuild also **consolidated the staged evidence tree**,
which had become split across two directories. All 2,106 assets now live in one tree and
were verified present and hash-correct against the database.

### The handle scan is now clear

Re-run over the corrected corpus, the single-character-edit scan across all **434**
ENWorld-scoped handles returned exactly one candidate: `coz` (1 prompt, Part I) beside
`BOZ` (28). With the Stage A source bundle supplied, that case is **settled from source
evidence: they are distinct handles and no merge is warranted.** `coz` occurs twice in
Part I and `BOZ` never; the second occurrence is `coz`'s own post byline (p.36, 5
September 2002), and the quote label Gygax carries on p.38 agrees with it. See
[the Stage A scope record](./gygax-stagea-reconciliation-scope.md).
