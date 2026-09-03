# Gygax Historical Testimony Corpus — Evidence Ingestion Rules

**Working control document** · Version 1.3 · 3 September 2026

> **Status.** Corpus-wide rules already established through ENWorld, Dragonsfoot,
> Ward, GameSpy, Cyclopeatron and Gamasutra work. This document governs future
> evidence preparation and ingestion unless contrary evidence requires an explicit
> revision.
>
> This is the canonical, governing form of the rules. The filename is deliberately
> unversioned: Git carries the history, and any ingestion commit points to the
> exact rules state that governed it via that commit's tree. The revision number,
> date and revision history below travel inside the document.

## 1. Governing principles

- Preserve first, classify second, interpret separately.
- The corpus is a historical testimony corpus, not a collected-works bibliography.
- The hierarchy is Person → source family → documentary object → testimony unit → evidence asset.
- The testimony unit follows the historical act of testimony. Preservation pagination, screenshot boundaries, PDF pages and archival segmentation do not define historical units.
- The evidence card follows the historical testimony unit. The preservation layer follows the received source.
- Contradictions are preserved. The database must not decide what Gygax "really thought" merely to produce a cleaner answer.
- Indeterminate and unknown are legitimate results. Do not manufacture precision.

## 2. Source boundary and inclusion

- Include material in which Gygax explains, judges, remembers, intends, describes design or play, discusses games/settings/history/people, or otherwise gives testimony that would matter independently of authorship of the underlying product.
- Keep in-world commentary as a separate discourse layer. Authored game material is excluded by default merely because Gygax wrote it.
- Practical inclusion test: would the passage still matter as historical testimony if someone else had written the underlying product? If Gygax is explaining why, how, judging, remembering or intending, it normally belongs.

## 3. Documentary objects and preservation

- Identify the historical documentary object before creating testimony units.
- Preserve the received source unchanged. Never overwrite, repair or silently normalise the preservation source.
- Record preservation artefacts separately from historical metadata. A print/PDF footer date is not a publication date unless independently established as such.
- Coverage may be complete, partial, fragmentary or unknown. "Complete as preserved" is preservation metadata and must not be silently equated with historical completeness.
- ENWorld Part I, II, III and similar preservation divisions are coverage segments, not separate documentary objects. The historical ENWorld Q&A thread is the documentary object.
- A later or abridged publication manifestation is related publication history, not automatically a duplicate testimony object.

## 4. Testimony-unit boundaries

- One numbered ENWorld post is one testimony unit.
- For formal interviews, one Gygax answer is normally one testimony unit; the interviewer's question is separate context.
- A testimony unit may occupy part of one preservation page, a whole page, or cross several preservation pages. Its historical boundary remains unchanged.
- Several testimony units appearing on one source page receive separate evidence cards.
- Do not split a historical testimony unit merely because the preservation format split it.

## 5. Evidence-card construction

- Universal rule: the card reconstructs the historical testimony unit; the preservation sources retain how that unit reached us.
- If one historical unit is contained within one preservation page, create one deterministic source-native crop.
- If a short or compact historical unit is artificially interrupted by a preservation-page boundary, create one continuous stitched card from the relevant source portions in their original reading order.
- Where a historical testimony unit naturally occupies several substantial pages, represent it as multiple ordered page or crop assets within the same unit rather than creating an oversized stitched image.
- Stitching may remove only preservation artefacts required to restore continuity, such as page boundaries, headers, footers, duplicated margins or blank page-space.
- Stitching must not rewrite, reflow, paraphrase, complete, correct, enhance or otherwise alter historical content.
- Every stitched card must retain ordered provenance to every preservation source portion used.
- The unchanged received PDF, screenshots, scans or source pages remain the preservation evidence and must be retained for audit.
- Ordinary deterministic single-source crops are derived assets but are not content-affecting reconstructions.
- Stitched cards are content-affecting reconstructions because omission at a join is possible. Every newly created stitched card therefore requires eyes-on comparison with all contributing source portions before acceptance.

## 6. Reconstruction verification

- Hashes prove that archived bytes equal prepared bytes; they do not prove that the prepared card contains all historical testimony.
- For every new stitched/content-affecting reconstruction, visually verify the complete card against every contributing source portion.
- Verify the join itself, not merely the beginning and end of the card.
- OCR may be used diagnostically as a warning system, but it is not evidence and is not a hard certification substitute for eyes-on verification.
- Do not generalise the reconstruction gate to ordinary single-source deterministic crops.
- Historical backlog marked provisional is grandfathering only, not evidentiary certification. New reconstructions still require acceptance.

## 7. Transcript and discovery text

- The transcript field contains only manually verified diplomatic transcription.
- `transcript_status` is `untranscribed` or `verified`.
- An untranscribed unit must not contain transcript text. A verified unit must not have an empty transcript.
- OCR, PDF extraction and machine-extracted text are `discovery_text` only until manually verified.
- Do not silently repair spelling, grammar or wording in diplomatic transcription.
- A quotation verified against an intermediary is verified as wording printed by that intermediary, not as verified against an unrecovered primary source.

## 8. Questions, context and attribution

- Questions and surrounding context are stored separately from Gygax testimony in `unit_context`.
- Context records have their own speaker and verification status.
- Questioner words must never enter Gygax testimony FTS merely because they appear on the same page or in the same interview exchange.
- Use `speaker_id`, `subject_person_id` and evidence relationship independently.
- Eyewitness testimony about Gygax is not rewritten as Gygax testimony.
- Intermediary quotation is not silently promoted to primary direct testimony.
- `quoted_question` is **functional**, not grammatical: it is the material the speaker
  selected and responded to — question, prompt, proposition, comment, joke or
  acknowledgement — whether or not it contains a question mark.
- **Source-scoped identity (v2.1).** A source handle identifies a speaker within the
  source context in which it is attested. Matching handle strings across independent
  source families do NOT establish personal identity. Cross-source identity must be
  independently established before identities are merged. Scope is identity metadata,
  never display text: the name holds the literal source label with no platform
  qualifier appended. Two same-named rows in different scopes are two *unresolved*
  source identities — not a positive claim that two different people existed.

## 9. Evidence relationships

Preserve at least the following distinctions:

- `direct`
- `direct_quotation_by_intermediary`
- `attributed_report`
- `attributed_paraphrase`
- `eyewitness_account`
- `editorial_or_authorial_inference`
- `unattributed_institutional_statement`
- `secondary_interpretation`
- `discovery_only`

The source role and the testimony relationship are separate questions. Secondary or
intermediary material remains useful and should be retained with the correct
relationship rather than discarded or promoted.

## 10. Numbering and locators

- `unit_number` is historical numbering only.
- Number status is `observed`, `independently_confirmed`, `inferred` or `unknown`.
- Never silently promote inferred numbering to observed.
- Printable-view positions, PDF sequence numbers and preservation-local positions are source locators, not historical post numbers.
- The 532 Stage A ENWorld manifest positions restart within preserved Parts and therefore remain locators; their `unit_number` is NULL/unknown.
- Number collisions go to reconciliation. They do not justify destructive overwrite or automatic historical resolution.

## 11. Dates and discourse

- Preserve date precision rather than manufacturing it: `minute`, `day`, `month`, `year` or `unknown`, with timezone only where supported.
- Do not convert preservation timestamps into publication timestamps.
- `discourse_mode` is an independent axis: `commentary`, `retrospective_commentary`, `in_world`, `rules_or_game_text` or `unknown`.
- Do not infer discourse mode merely to fill a field. Unknown is valid.

## 12. Completeness

- `completeness` values are `complete`, `partial`, `fragment` or `unknown`.
- Complete means complete for the identified historical documentary/testimony object supported by evidence, not complete for every conversation or unpublished exchange that may once have existed.
- An intermediary quotation may be complete as reproduced by the intermediary while remaining a fragment of an unrecovered original post. Record the distinction rather than collapsing it.

## 13. Search and FTS

- Transcript, context, discovery and tags searches are distinct.
- Combined search must label why a result matched.
- Questions do not enter Gygax testimony FTS until they are Gygax testimony, which ordinarily they are not.
- Unverified discovery text does not become verified transcript merely because it is searchable.
- Tags are finding aids, not historical facts. Exact tag matching is the corpus rule; fuzzy/typeahead behaviour is a separate UI convenience.
- FTS external-content tables require INSERT, UPDATE and DELETE synchronisation plus rebuild/integrity verification.

## 14. Related testimony and contradictions

- Use source-neutral related-testimony relationships.
- Permitted analytical relationships include `same_subject`, `consistent`, `elaboration`, `changed_position`, `different_context`, `apparent_contradiction` and `unresolved`.
- Relationships organise evidence; they do not authoritatively reconcile it.
- Recovery of a primary source may supersede an intermediary source as evidentiary authority without erasing the intermediary's historical existence.
- When a recorded unresolved lead is later recovered, treat the reconciliation as new evidence work and preserve any wording, date or context differences.

## 15. Provenance and integrity

- A testimony unit may have one or more ordered evidence assets. Compact units split accidentally by preservation pagination may be stitched into one continuous card; long testimony naturally occupying several substantial pages should remain a multi-page evidence unit.
- Every derived evidence asset must trace to its preservation source or sources.
- Browser-decrypted evidence must SHA-256 verify against the database before display.
- AES-GCM AAD is optional; plaintext hash verification is mandatory.
- SQLite foreign keys must be enabled.
- `UNIQUE(object_id, sequence_in_object)` remains structural.
- Integrity checks, evidence hashes, migration counts, FTS checks and reconciliation reports must pass before deployment.

## 16. One-source-at-a-time workflow

1. **Preserve and identify.** Establish the documentary object, provenance, authorship/speaker relationships, date precision and preservation condition.
2. **Research.** Locate original venue, publication history, primary sources behind intermediary material, and relevant corroborating or contradictory testimony.
3. **Analyse and classify.** Separate direct testimony, intermediary quotation, attributed report, eyewitness evidence, secondary interpretation and discovery leads.
4. **Prepare evidence.** Create cards at historical-unit granularity under the universal crop/stitch rule.
5. **Verify.** Visually verify all new content-affecting reconstructions; establish transcript, completeness, date and number status only as far as evidence bears.
6. **Package and ingest.** Only after historical decisions are settled. Code tests the package against the frozen architecture rather than deciding historical questions during ingestion.
7. **Validate archive result.** Check counts, FTS separation, evidence rendering, provenance, attribution, coverage, hashes, integrity and reconstruction controls.
8. **Close the source.** Record unresolved leads. Do not move to the next source until the current one is validated and closed.

## 17. Architecture and deployment controls

- The v2 schema is frozen against preference-driven redesign, but contrary evidence can require explicit reconsideration.
- If a source cannot be represented without violating an established evidentiary distinction, stop and report the mismatch rather than compensating silently.
- Evidence-preparation mistakes are corrected upstream in the evidence package. Code should not learn repair logic for preparation errors.
- Corrected packages replace erroneous derived assets through the reproducible pipeline; received preservation sources remain retained for audit.
- v1 remains untouched until explicit deployment decision.
- No deployment occurs merely because ingestion succeeds.

## 18. Established examples

- **ENWorld.** One numbered post is one testimony unit. Preservation "Parts" are coverage segments. Printable-view positions are locators, not historical post numbers.
- **Ward Greyhawk #2.** A PDF page break split one continuous Facebook post. The corrected evidence restored the continuous historical testimony and demonstrated why hashes alone cannot validate reconstruction completeness.
- **GameSpy Part I.** Seven compact interview answers cross preservation pages. Because these are short answers accidentally interrupted by pagination, the preferred final representation is a continuous stitched card.
- **Cyclopeatron.** A quoted Gygax passage can be verified as wording printed by an intermediary while the primary remains unrecovered. Fisher/2007/GenCon material remains attributed/discovery material rather than being promoted.
- **Gamasutra.** Formal interview: Gygax answers are testimony units; Harvey Smith questions are context. Compact cross-page answers are stitched into continuous cards while the received PDF remains unchanged.

## 19. Change-control rule

Do not re-decide these rules source by source. A new source should be processed
under this control document. If evidence genuinely exposes a rule that is wrong or
insufficient, record an explicit amendment with the reason and affected prior
objects. A convenience preference or one awkward source is not by itself grounds for
changing the corpus model.

## 20. External verification gate

- External verification is distinct from evidence-card visual verification. Before a source is packaged for ingestion, record what has and has not been independently established outside the supplied preservation.
- Verify documentary identity where possible: author/speaker, title, venue, issue or object identity, and historical date. Separate publication dates from preservation timestamps.
- Verify publication history where relevant: original appearance, reprints, mirrors, abridgements, later manifestations and whether the supplied item is original, facsimile, reproduction or intermediary preservation.
- Test substantive historical claims used for classification against independent evidence where reasonably available. Examples include whether an account describes actual play, who participated, whether a quoted source existed, or whether a later witness identifies the same event.
- Distinguish bibliographic/substantive verification from textual collation. Independent confirmation that an article is genuine does not prove that an intermediary reproduction is word-for-word identical to the original.
- If exact textual fidelity has not been checked against an original or authoritative facsimile, state that explicitly. Do not mark a transcript verified merely because historical identity is secure.
- Record negative results and unresolved points. "Not independently verified" is a valid archival state and must not be silently converted into probability or fact.
- External sources may corroborate or challenge classification, but they do not overwrite the preserved source. Contrary evidence triggers review and, if necessary, explicit amendment.
- The package should carry a concise external-verification record stating: verified claims, unverified claims, sources consulted, and consequences for ingestion.

---

## Revision history

Amendments append here with a reason and the prior objects affected (§19). The
filename stays unversioned; this log and the header date carry the revision state.

- **v1.3 — 3 September 2026.** §8 amended for attribution, driven by evidence, under
  §19. (a) `quoted_question` recorded as a functional category, which removed a
  proposed `quoted_context` schema amendment as unnecessary. (b) **Source-scoped
  identity** added after the Dragonsfoot quote-back pass produced the handles `Bregh`
  and `gideon_thorne`, already attested on ENWorld. Under `UNIQUE(name)` the corpus
  could only merge them (asserting identical strings on independent forums are the
  same human), rename them (falsifying the source label), or discard known
  attribution — all semantic loss. Schema amended to v2.1: `persons.identity_scope`,
  with scope-aware uniqueness. Affected prior objects: the 186 ENWorld Stage A handle
  rows acquire `ENWorld Q&A` scope; their names are unchanged.
- **v1.2 — 3 September 2026.** Consolidated corpus-wide rules as established through
  ENWorld, Dragonsfoot, Ward, GameSpy, Cyclopeatron and Gamasutra. Canonical form
  committed to the repository so ingestion commits resolve their own rule references.
