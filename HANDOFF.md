# Handover — Vaults of the ODD

Everything an AI assistant or developer needs to take over this website. It is a
standard [Hugo](https://gohugo.io) static site in a single git repository, so
the machinery is portable and nothing depends on any one tool or assistant. This
file records the conventions that are **not** obvious from the code alone.

For routine editing, see `README.md`. This file is the deeper picture.

## The 30-second orientation

- **Hugo extended**, pinned to the version in `.github/workflows/deploy.yml`
  (`HUGO_VERSION`, currently 0.140.2).
- One repository: **`statemagister/vaultsoftheodd-site`**, default branch
  **`main`**.
- **Push to `main` → GitHub Actions builds and deploys to GitHub Pages.** That
  is the only environment. There is no separate server. The build output
  (`public/`) is git-ignored — never commit it.
- Content lives in `content/<vault>/`, templates in `layouts/`, styles in a
  single `assets/css/main.css`. Site config is `hugo.toml`.
- Served at <https://www.vaultsoftheodd.com>. The domain is registered at
  Porkbun; `static/CNAME` tells GitHub Pages which domain to answer on.

## The vaults

Each vault is a top-level folder under `content/`. A vault appears in the header
menu via `[menus.main]` in `hugo.toml`.

| Vault | Path | Landing layout | Article layout | Notes |
|---|---|---|---|---|
| Gaming | `content/gaming/` | `layouts/gaming/list.html` | `layouts/_default/single.html` | TTRPG analysis. Served at site root (`/<slug>/`) via the `permalinks` rule, preserving the old WordPress URLs. Uses the `settings` taxonomy (Ravenloft, Greyhawk…). |
| Money | `content/money/` | `layouts/money/list.html` | `layouts/money/single.html` | A weekly plain-language series. The most intricate publishing model — see below. |
| Politics | `content/politics/` | `layouts/politics/list.html` | `layouts/_default/single.html` | Analytical papers, grouped into sections. Carries `ScholarlyArticle` JSON-LD (`layouts/partials/schema.html`). |
| Journals | `content/journals/` | `layouts/journals/…` | — | The journal range (shop). |
| Stories | `content/stories/` | `layouts/_default/…` | `layouts/_default/single.html` | Fiction. |
| Mythology | `content/mythology/` | `layouts/_default/…` | `layouts/_default/single.html` | |

Anything without a vault-specific layout falls back to `layouts/_default/`.

## How publishing works — read this before touching any date

**`buildFuture` is OFF** (there is no `buildFuture` in `hugo.toml`, so Hugo's
default applies). The consequences are the whole scheduling model:

- A `draft: false` article with a **future date is not built at all** until a
  build runs on or after that date. It is invisible — no page, no RSS entry, not
  in search, not reachable by URL.
- A `draft: true` article is never built until the flag is flipped, regardless
  of date.
- Therefore **a build must happen for a scheduled post to appear.** Builds run
  on: every push to `main`; a manual `workflow_dispatch` (Actions tab → Run
  workflow); and a **set of Monday-morning cron schedules** in `deploy.yml`.

### Getting posts live *by* 08:00 (the cron + date design)

You cannot publish an 08:00 post with a build that runs before 08:00 — Hugo
would still treat it as future and omit it. So the design is:

- Weekly articles are dated **07:00 local time** (the listing shows the date
  only, never the time, so readers see no difference).
- `deploy.yml` fires **several builds between 07:05 and 07:45 local**, plus an
  08:05 safety net, with each local time expressed as both a summer (BST,
  UTC+1) and winter (GMT, UTC+0) cron. This absorbs GitHub's habit of delaying
  scheduled runs by 10–30 minutes, so a post is reliably live before 08:00.

If a Monday run is late or missed, just trigger the deploy manually — it is
idempotent.

### The Money series — reading order is not publication order

This trips up every newcomer. Keep the two ideas separate:

- **`weight`** is the **reading order** (1→n, spaced in tens so an article can
  be inserted between two others by editing one line). The landing page lists
  articles in weight order — that list is "the journey," and position one is
  always where a new reader starts. Navigation and prev/next links follow
  `weight`, never the date.
- **The date** is only the **publication schedule.** Publication follows reading
  order *except* the two seasonal student articles, which were pulled forward to
  3 August because they are time-sensitive. They carry timestamps one minute
  apart (08:00 / 08:01) so a newest-first view sorts them in reading order.
- The **`schedule` array in `content/money/_index.md`** drives the landing page:
  each entry renders as a dated teaser, and once an article's date has passed and
  it is built, the teaser becomes a live linked card. Titles/teasers there are
  only shown *before* an article publishes; after that its own front matter wins.
- **Three articles are `draft: true` on purpose** (What Is the Job Actually
  Paying?, What Do You Do When You Don't Know?, How Do You Take a Pension?).
  Their publication is gated on an event, not a date. They are flipped to
  `draft: false` by hand when the condition is met. The reason is recorded in the
  private editorial docs, not here. **Do not flip them or move them earlier.**
- **"New this week"** (top of `layouts/money/list.html`) surfaces every live
  article sharing the most recent publication date — two on the seasonal launch
  Monday, one every week after. It does not reorder the list.
- **"Last updated"** renders from Hugo's `lastmod` and appears **only** when
  `lastmod` differs from `date`. Set `lastmod` in front matter **only for a
  substantive post-publication change** to a *live* article — a moved figure, a
  corrected fact, a dead link replaced — never for a typo, a rephrasing, or an
  edit to an article that has not published yet (no reader saw the old version).
  `lastmod` also feeds the sitemap.

### The Politics papers

- `content/politics/_index.md` front matter defines the **`sections`**
  (framework / evidence / supporting / standalone) and their order and intros.
- A paper joins a section through its front-matter **`series`** key and sorts
  within it by **`weight`**.
- Each paper carries a `description` and controlled-vocabulary `tags`, and the
  site emits `ScholarlyArticle` JSON-LD for it via `layouts/partials/schema.html`
  (note: `jsonify` inside a `<script>` needs `| safeJS`, not `safeHTML`).

## What is deliberately **not** in this repository

The editorial control documents — **SERIES.md, HANDOVER.md, PRINCIPLES.md** — are
intentionally kept out of version control and held privately by Drew. The repo
carries the *mechanics*; the *content judgment* — tone and register, what each
article deliberately omits and why, the event that gates the hidden drafts, the
reasoning behind the series — lives only in those documents. A successor needs
them from Drew to make content decisions. Nothing in the repo reproduces them,
and they should not be committed.

## Accounts a successor needs (these cannot live in the repo)

- **GitHub** — the repository, Actions, and Pages.
- **Porkbun** — domain registration and DNS for `vaultsoftheodd.com`.
- **Cloudflare** — cookieless Web Analytics. The token in `hugo.toml` is a
  public, page-embedded token, *not* a secret; it is fine in version control.
- **buymeacoffee** and **eBay** — the support and shop links in `hugo.toml`.
- **giscus / GitHub Discussions** — if comments are enabled (see `README.md`).

## Adding a new vault (e.g. the planned Economics section)

1. Create `content/economics/_index.md` with at least `title` and
   `description`. Add any section-specific front matter the landing layout reads
   (Money uses a `schedule` array; Politics uses `sections`).
2. Decide on a layout. The generic `layouts/_default/{list,single}.html` will
   serve it out of the box. For a custom landing or article style, add
   `layouts/economics/{list,single}.html` — copying `layouts/money/` or
   `layouts/politics/` is the fastest start.
3. Add a menu entry under `[menus.main]` in `hugo.toml` (pick a `weight` to slot
   it where you want in the header). **The header renders every menu item**, so
   if you want the vault hidden until its first article is live, add the menu
   entry only at launch, or reintroduce a published-count guard in
   `layouts/partials/header.html`.
4. If it needs its own taxonomy or a special URL shape, extend `[taxonomies]` or
   `[permalinks]` in `hugo.toml`.
5. Optionally add a 1200×630 social-share banner at
   `static/images/og-economics.png` and cascade it from `_index.md` the way
   `content/money/_index.md` does.
6. Add articles as `.md` files with front matter, commit, and push.

## Things not to "helpfully" fix

- **Reading order ≠ publication order** in Money (and the two seasonal articles
  jump the queue). If they ever *look* inconsistent, they are correct — reread
  the Money section above before changing a date or a weight.
- **Never commit `public/`** — it is generated.
- **Do not add `lastmod`** to an article that has not published yet, or for a
  trivial edit. It is a signal to returning readers, not a changelog.
- **Article dates are 07:00 by design**, not 08:00 — that is what lets the
  pre-08:00 build window publish them on time. Don't "correct" them to 08:00.
- **The three `draft: true` Money articles are event-gated.** Leave the flag.
- **British English in prose, American English in slugs** (search-friendliness);
  titles keep British spelling.
