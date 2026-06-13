# Vaults of the ODD — website

The [vaultsoftheodd.com](https://www.vaultsoftheodd.com) website, built as a
static site with [Hugo](https://gohugo.io) and deployed to GitHub Pages. This
replaces the previous WordPress install.

## Structure

```
content/
  _index.md            Homepage intro
  about.md             About page
  contact.md           Contact page
  privacy-policy.md    Privacy policy (UK GDPR)
  journals/_index.md   The journal range (shop)
  gaming/              Gaming vault — TTRPG analysis (Ravenloft essays live)
  stories/             Stories vault (coming soon)
  mythology/           Mythology vault (coming soon)
  politics/            Politics vault (coming soon)
layouts/               Custom theme (templates + partials)
assets/css/main.css    Dark archival theme: Cinzel + EB Garamond, gold accents
static/wp-content/...  Images and PDFs migrated from WordPress
static/CNAME           Custom domain served by GitHub Pages
.github/workflows/     Build + deploy to GitHub Pages on push to main
```

Gaming essays are stored under `content/gaming/` but served at the site root
(`/<slug>/`) via the `permalinks` rule in `hugo.toml`, so the original
WordPress article URLs are preserved.

## Adding content

Drop a new `.md` (or `.html`) file into the right vault folder with front
matter, then commit and push to `main`. GitHub Pages rebuilds automatically.

```
---
title: "Your title"
date: 2026-06-13
slug: "your-slug"
settings: ["Ravenloft"]
tags: ["Source Analysis"]
---
Body here.
```

## Local preview

```
hugo server -D
```

## Deployment

Push to `main`. The GitHub Actions workflow builds with Hugo and deploys to
GitHub Pages. The served domain is whatever is in `static/CNAME`
(currently the `.net` staging domain; change to `www.vaultsoftheodd.com` at
cutover).

## Comments

Comments use [giscus](https://giscus.app) (GitHub Discussions). Enable
Discussions on the repo, install the giscus app, then fill in the
`[params.giscus]` values in `hugo.toml`. Leaving `repo` blank keeps comments
off.
