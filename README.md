# Vaults of the ODD — website

The [vaultsoftheodd.com](https://www.vaultsoftheodd.com) website: a static site
built with [Hugo](https://gohugo.io) and deployed to GitHub Pages on every push
to `main`.

This README covers day-to-day editing. For the bigger picture — how scheduled
publishing works, the Money series' conventions, adding a whole new vault, and
what a successor needs to take over — see **`HANDOFF.md`**.

## Structure

```
content/
  _index.md            Homepage
  about.md, contact.md, privacy-policy.md, cookie-policy.md
  gaming/              Gaming vault — TTRPG analysis (served at /<slug>/)
  money/               Money vault — a weekly plain-language series
  politics/            Politics vault — analytical papers, grouped in sections
  journals/            The journal range (shop)
  stories/             Stories (fiction)
  mythology/           Mythology
layouts/
  _default/            Fallback list/single templates
  money/ politics/ gaming/ journals/   Vault-specific templates
  partials/            head, header, footer, search, listen, schema, …
assets/css/main.css    The whole theme: Cinzel + EB Garamond, gold accents,
                       light/dark + per-vault palettes
static/                Images, PDFs, fonts, CNAME, favicon
hugo.toml              Site config: params, menus, taxonomies, permalinks
.github/workflows/     deploy.yml (build + deploy) and link-check.yml
```

`public/` is the generated build output and is git-ignored — never commit it.

## Adding a normal article

Drop a new `.md` file into the right vault folder with front matter, commit, and
push to `main`. GitHub Pages rebuilds automatically.

```yaml
---
title: "Your title"
date: 2026-06-13
tags: ["Source Analysis"]
settings: ["Ravenloft"]   # Gaming vault only
---
Body here.
```

Front matter differs by vault:

- **Gaming** — `title`, `date`, `settings` (taxonomy: Ravenloft, Greyhawk…),
  `tags`. Served at the site root via the `permalinks` rule.
- **Politics** — `title`, `date`, `series` (which section it joins), `weight`
  (order within the section), `description`, `tags`.
- **Money** — `title`, `date`, `weight` (reading order), `draft`, `description`,
  `tags`, optional `subtitle`. **The Money model is specific — read the Money
  section of `HANDOFF.md` before adding or dating a Money article**, and add a
  matching entry to the `schedule` array in `content/money/_index.md`.

`description` is used as the meta description and social-card text, so write it
as a standalone teaser (don't rely on the first paragraph).

## Scheduled publishing (in brief)

Future-dated `draft: false` articles are **not built until their date passes** —
that is how posts self-release. A build must run for a scheduled post to appear,
so `deploy.yml` runs Monday-morning cron builds in addition to build-on-push.
The full timing design (including how posts land reliably before 08:00) is in
`HANDOFF.md`. To publish something immediately, push any commit or run the deploy
manually (Actions → *Deploy site to GitHub Pages* → **Run workflow**).

## Local preview

```
hugo server -D          # -D also renders drafts
```

Include future-dated content in a local build with `hugo server --buildFuture`.

## Deployment

Push to `main`. The GitHub Actions workflow (`.github/workflows/deploy.yml`)
builds with `hugo --minify --gc` and deploys to GitHub Pages. The live domain is
whatever `static/CNAME` contains (`www.vaultsoftheodd.com`). `baseURL` in
`hugo.toml` is the canonical source for absolute URLs (sitemap, canonical tags,
Open Graph).

## Comments

Comments use [giscus](https://giscus.app) (GitHub Discussions). Enable
Discussions on the repo, install the giscus app, and fill in the
`[params.giscus]` values in `hugo.toml`. Leaving `repo` blank keeps comments off.

## Analytics

Cloudflare Web Analytics (cookieless). The token in `hugo.toml`
(`params.cloudflareToken`) is public and page-embedded; clearing it removes the
snippet.
