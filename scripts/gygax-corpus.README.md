# Gygax ENWorld Q&A — private encrypted research page

A search instrument over the recovered Gygax ENWorld Q&A corpus, served as an
unlinked page on the (public) GitHub Pages site. The corpus is deployed **only**
in encrypted form; it is decrypted in the browser with a passphrase and searched
locally. Nothing about the corpus is readable without the passphrase.

`noindex,nofollow` and the unlinked URL are only discoverability measures. **The
AES-256-GCM encryption is the actual protection.**

## How it works

- Page: `/research/gygax/` — standalone template `layouts/research/gygax.html`,
  content stub `content/research/gygax.md` (rendered, but excluded from all
  listings, the sitemap and the site search index).
- Client: `static/research/gygax/gygax-search.js` — prompts for the passphrase,
  derives a key with **PBKDF2-HMAC-SHA-256 × 600,000**, decrypts the corpus with
  **AES-256-GCM**, gunzips it, opens it with **@sqlite.org/sqlite-wasm** (SQLite
  3.53.0, FTS5) in memory, and searches with FTS5 (`bm25()`, `snippet()`,
  phrases, `AND`/`OR`/`NOT`, prefix). The passphrase is never stored or
  transmitted; the decrypted database lives only in memory for the session and is
  never written to persistent browser storage.
- Deployed asset: `static/research/gygax/gygax_enworld.enc` — the encrypted,
  gzipped, rollback-mode copy of the corpus. This is the only corpus form that is
  ever committed or deployed.

## Building / updating the encrypted asset

Requires Node ≥ 22.5 (`--experimental-sqlite`) or Node ≥ 24. The canonical
`gygax_enworld.sqlite` is kept locally and is **gitignored** — never commit it.

```
node --experimental-sqlite scripts/build-gygax-corpus.mjs /path/to/gygax_enworld.sqlite
```

The script: makes a rollback-mode deployment copy with `VACUUM INTO` (the
canonical database is opened read-only and never modified); **verifies** the copy
against the canonical database and aborts without producing an asset if anything
fails —

- `PRAGMA integrity_check = ok`
- document / chunk / coverage / annotation counts match the canonical database
- a deterministic content hash over the substantive data matches the canonical
- FTS5, `bm25()`, `snippet()` are available
- the versioned regression searches (`gygax-regression.v1.json`) match

— then prompts for the passphrase (hidden input; never stored), gzips, encrypts,
writes the `.enc`, deletes the derived plaintext copy, and prints an audit trail
(canonical and derived SHA-256). Commit the `.enc` and push to deploy.

## New corpus version (v2, …)

The regression counts are **version-specific**. When you replace the canonical
database, regenerate the expectations deliberately:

```
node --experimental-sqlite scripts/build-gygax-corpus.mjs new.sqlite --regen-expectations   # rewrites gygax-regression.v1.json
# review the diff, then a normal build verifies against the new expectations
node --experimental-sqlite scripts/build-gygax-corpus.mjs new.sqlite
```

The interface reads coverage, parts, authorities and counts from inside the
database at load, so a fuller Part III, new parts, or post-level records appear
with no code change.

## Regression test (real page, end to end)

```
# 1. build the site:            hugo --minify
# 2. produce a TEST asset with a KNOWN test passphrase (never the production one):
node --experimental-sqlite scripts/build-gygax-corpus.mjs gygax_enworld.sqlite --out public/research/gygax/gygax_enworld.enc
# 3. serve and run (needs playwright-core + a Chromium):
python3 -m http.server 8200 --directory public &
GYGAX_TEST_PASSPHRASE='<the test passphrase>' node scripts/gygax-browser-regression.mjs
# 4. remove the test asset from public/ afterwards.
```

## Passphrase — read this

The `.enc` is a static, publicly downloadable file, so an attacker who fetches it
can guess passphrases **offline**, with no rate limit and nothing you can revoke.
PBKDF2 raises the per-guess cost but is not memory-hard, so **the passphrase
entropy is what actually protects the corpus.**

- Use a **randomly generated Diceware passphrase of at least six words** (the
  build script enforces a 6-word minimum). Seven words is better.
- Generate it randomly (diceware / a password manager). Do not hand-pick, reuse,
  or use anything guessable.
- Rotating the passphrase means re-encrypting and redeploying, and **any copy of
  an old `.enc` already downloaded stays attackable under its old passphrase** —
  so choose a strong one from the start and treat a leak as "re-encrypt and
  regard that corpus version as exposed."

## What is and isn't in Git

- **In Git / deployed:** the page, template, client JS, the sqlite-wasm runtime,
  the build and test scripts, and (once you generate it) the encrypted `.enc`.
- **Never in Git:** the plaintext `gygax_enworld.sqlite` (canonical or derived —
  both covered by `.gitignore`) and the passphrase (nowhere in the repo, site or
  config).
