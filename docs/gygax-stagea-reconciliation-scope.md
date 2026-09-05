# EN World Stage A reconciliation — scope and source findings

**Written:** 5 September 2026, against corpus commit `32ffb46`
**Source bundle:** `gygaxenworldstageAreconciliationSOURCEBUNDLE20260905.zip`,
sha256 `6b6de4b5cf51d9380b54b1fe35acc37180ee1b26ead2618c70c66e837cd9c86f`

This is **scoping evidence for the upstream reconciliation pass**, not a correction and
not a set of conclusions. Every identity question below is left open for historical
judgement. Nothing here has been ingested.

## Bundle verification

| PDF | sha256 | pages |
|---|---|---|
| `enweggqa01.pdf` | `8771a8d1…41aedf` | 214 |
| `enweggqa02.pdf` | `6b3ff0c1…f888a5e` | 109 |
| `enweggqa08.pdf` | `ec4962ce…c56516` | 113 |

All three match the declared hashes exactly; 4/4 internal checksums verify; the ZIP
matches its declared hash. When the reconciliation package embeds these same bytes, as
intended, these hashes are what it should reproduce.

## `coz` / `BOZ` — settled from source, no change warranted

The bundle's method requires this be resolved "only from source evidence, never edit
distance". It is, and the answer is that **they are distinct handles**:

- **`coz` occurs twice in Part I and `BOZ` occurs zero times there.** Conversely `BOZ`
  occurs 14 times in Part II and 19 in Part VIII, where `coz` never appears. The two
  never co-occur in any document.
- The second Part I occurrence is a **post byline**: `coz — Thursday, 5th September,
  2002, 11:48 PM` (p.36), rendered intact.
- Gygax quotes that post on p.38 (6 September 2002, 02:35 PM), and the rendered quote
  label reads `Originally posted by coz`, also intact.
- So the antecedent header and the quote label **agree**, and `coz` is a genuine
  participant with a post of their own — not glyph damage of `BOZ`.

The single-character similarity that surfaced this pair is coincidence. **No merge, no
correction.** This closes the last open item from the Part IV handle scan.

## Scope of the 485 label-derived attributions

Parts I, II and VIII hold **645 prompt contexts, of which 485 are attributed** and 160
carry no speaker. Tracing each attributed prompt's wording back to a post that carries it
as its *own* text (not inside a quote box) gives:

| outcome | count | share of 485 |
|---|---|---|
| antecedent recovered, **agrees** with the stored attribution | 254 | 52% |
| antecedent recovered, **disagrees** | 8 | 2% |
| antecedent **not recoverable** from these three PDFs | 212 | 44% |
| prompt too short to trace safely | 11 | 2% |

The 44% unrecoverable is the substantive scoping result: **roughly half of Stage A cannot
be moved onto the antecedent standard from these three documents alone.** Those prompts
quote posts that are not present as originals in the same Part PDF — most likely quoted
across part boundaries, or from posts the preservation run did not capture. They should
be expected to remain explicitly unresolved, exactly as the bundle's method allows.

## The eight antecedent/label disagreements — candidates, not findings

| part | stored (label-derived) | antecedent byline | antecedent page |
|---|---|---|---|
| I | Fourecks | DDK | 4 |
| I | Baraendur | Darrin Drader | 187 |
| II | Baraendur | Darrin Drader | 1 |
| II | Baraendur | Darrin Drader | 8 |
| II | Baraendur | Darrin Drader | 8 |
| II | Tallarn | Mathew_Freeman | 41 |
| II | Baraendur | Darrin Drader | 44 |
| VIII | Jodjod | Captain NeMo | 68 |

Two were checked directly against the source, and both have the same shape: **the stored
name is never a byline anywhere in that document, while the antecedent name is.**
`Fourecks` appears 3 times in Part I and never as a post header; `DDK` does head a post.
`Jodjod` appears exactly once in Part VIII — as the quote label itself — while
`Captain NeMo` heads a post.

That is consistent with a display-name/username distinction, or a renamed account, or a
mistaken label. **It is not evidence of personal identity and no merge follows from it.**
Per the standing rule, matching or mismatching handle strings do not establish identity;
these are recorded so the upstream pass can weigh them.

## Limits of this measurement — read before relying on it

Two earlier attempts in this family produced numbers that were artefacts, and **this pass
produced two more before it produced anything usable.** Both were caught by controls
rather than by inspection, which is the only reason the figures above are offered at all:

1. **First attempt took the earliest post containing the wording.** But a quoting post
   contains the wording too, inside its quote box, so whenever the original was absent the
   method silently fell back to Gygax's own post. It reported 124 "disagreements", of
   which nearly all named `Col_Pladoh` as the antecedent of a participant's prompt. The
   fix requires the wording to precede any `Originally posted by` marker within the post;
   `Col_Pladoh` then accounts for 0 of 262 recovered antecedents.
2. **Second attempt joined `discovery_text` on `unit_id` alone**, which cross-multiplied
   against the 82 Stage A units carrying more than one prompt and paired every speaker
   with every prompt on its unit — 645 rows for 485 attributions. The fix matches the
   discovery locator's own `quoted prompt N — <name>` fragment, and the count is now
   exactly 485.

Remaining known limits, not defects but boundaries:

- the antecedent is taken as the **earliest** post carrying the wording as own text; if a
  participant quoted another participant, that could mislead;
- antecedents are searched **only within the same Part document**, so a prompt quoting
  across part boundaries counts as unrecoverable rather than being traced;
- the two controls (the `coz` case resolving correctly, and Gygax almost never appearing
  as an antecedent) are necessary but not sufficient.

The 8 disagreements are therefore a **candidate list to verify**, not a correction set.
