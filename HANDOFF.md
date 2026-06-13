# Handoff — Vaults of the ODD website

This is the complete Hugo static site for **vaultsoftheodd.com**, migrated from
the old Porkbun WordPress install. It is ready to deploy to GitHub Pages from
the repo **statemagister/vaultsoftheodd-site**.

## What still needs doing (for whoever picks this up)

1. **Get these files into the repo.** Commit everything here to the `main`
   branch of `statemagister/vaultsoftheodd-site` and push. (The build output
   folder `public/` is intentionally git-ignored; do not commit it.)

2. **Turn on GitHub Pages.** On GitHub: repo → **Settings** → **Pages** →
   under **Build and deployment → Source**, choose **GitHub Actions**. The
   workflow in `.github/workflows/deploy.yml` builds with Hugo and deploys
   automatically on every push to `main`.

3. **Point the staging domain.** `static/CNAME` is set to
   `www.vaultsoftheodd.net` for staging. In Porkbun, add a CNAME DNS record
   for the `.net` domain pointing at `statemagister.github.io`, plus the four
   GitHub Pages A records / AAAA records on the apex if the bare domain is
   used. Verify the `.net` site renders correctly against the old `.com` site.

4. **Cutover to .com** once verified: change `static/CNAME` to
   `www.vaultsoftheodd.com`, push, and repoint the `.com` DNS in Porkbun.
   Keep the old Porkbun WordPress DNS values recorded first, as rollback.

5. **Optional follow-ups:** enable GitHub Discussions + the giscus app and
   fill in `[params.giscus]` in `hugo.toml` to switch comments on; self-host
   the fonts; add a 1200x630 social sharing image.

## What was migrated

- All 14 published Ravenloft essays, kept at their original root URLs
  (e.g. `/the-holy-symbol-of-ravenkind/`) so existing links and Search Console
  indexing survive.
- All article images and the three Playability Guide PDFs, rehosted under
  `static/wp-content/uploads/`.
- About and Privacy pages (privacy rewritten for the static/GitHub setup).
- Structure: Home, Journals (shop), and the Gaming / Stories / Mythology /
  Politics vaults.

See `README.md` for day-to-day editing.
