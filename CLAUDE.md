# Working on The Butler's Ledger (phone app)

## Rules from the owner
- **Always push changes to `main`.** Commit straight to `main` and push it; no feature branches or pull requests unless the owner asks for one. GitHub Pages serves `main`, so a push is a release.
- Show times in Eastern Time only ("ET"); never mention UTC to the owner.
- Use American units (lb).
- The owner is not a programmer: explain changes in plain English.

## How this repo fits together
- This repo is PUBLIC. It must never contain the owner's personal data (his workouts, routine names, notes) or any key. `demo-data.json` is invented sample data.
- The app reads the private repo `patrick-simpson/Hevy-Butler` through the GitHub API with a key stored only in the phone's browser. The shared formats are in that repo's `docs/data-format.md`; `settings_schema.json` here must stay identical to the butler's `butler/settings_schema.json`.
- Before every push that changes the app, run `python3 tools/bump_version.py`. It bumps the edition in `sw.js`, `index.html`, `js/app.js` and `styles.css` together; `js/boot.js` checks they match when the app opens and repairs a phone that mixes editions.
- Render all data as text (no `innerHTML` with data).
- Keep the ledger look: paper, ink, oxblood; no gradients, glass, pill badges or emoji icons.
