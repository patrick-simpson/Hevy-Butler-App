# The Butler's Ledger

The phone app for **The Deadlift Butler**, the polite British butler who looks in
on your Hevy workouts twice a day (about 10 in the morning and 10 at night,
Eastern) and coaches you along.

Open it here: **https://patrick-simpson.github.io/Hevy-Butler-App/**

## What it does

- **Sync** (the button at the top right): makes the butler check Hevy right now
  instead of waiting for his next look-in. He does a full round, and the ledger
  shows what he found when he is done, usually within a minute or two.
  Pulling down on the page only re-reads the ledger.
- **Ledger**: at the top, the butler's report on your latest workout: his
  message, the figures (time taken, exercises, sets, total weight moved and how
  that compares with the last time you did the same workout, new records), what
  went well, what to aim for **next time** (in big type, for reading between
  sets), his advice and a P.S. Below that, how each lift is coming along, with a
  small chart.
- **Awaiting your word**: bigger changes he'd like to make. Approve or decline with one tap.
- **Ask** ("A word with the butler"): type a question about your training and
  press **Ring for an answer**. He reads your whole Hevy history and the ledger,
  and his reply appears as a letter, usually in about 45 seconds, at roughly a third of a cent a question. He
  remembers the last few letters of the conversation; **Start afresh** begins a
  new one (earlier conversations are kept, folded away by number). Questions are
  answered by Claude Haiku 5.5, and a question never changes a routine. You can
  close the app while he writes: it carries on waiting when you open it again.
- **Household book**: everything he has done, newest first, with each review's
  report in brief.
- **House rules**: how much he may change on his own, which routines he may tune,
  which Claude model writes his reviews (Sonnet, Opus or the very thrifty Haiku),
  and a button to make him rehearse on your latest workout (nothing in Hevy changes).

Phone and email alerts are off by choice: no buzzes, no emails. Open the ledger whenever you
like to see what he has been up to. All times are Eastern Time.

## No personal data lives here

This repository is public and holds only the app itself, plus invented sample
figures for the "have a look around first" tour. Your workouts stay in your
private `Hevy-Butler` repository. The app reads them with a GitHub key that you
paste in, and that key is kept only in your phone's browser.

## Install it on your Android phone

1. Open the link above in **Chrome**.
2. Tap the **⋮** menu (top right), then **Add to Home screen** (or **Install app**).
3. Tap **Install**. The top hat appears on your home screen.
4. Open it and choose **Connect**. The app explains how to make the GitHub key.
   It takes about two minutes.

To disconnect, go to **House rules** and press **Forget my key**.

## For whoever maintains it

Plain static files with no build step: `index.html`, `styles.css`, `js/`
(ES modules), `sw.js` (offline support), `manifest.webmanifest` and `icons/`.
**With every release, bump `VERSION` in `sw.js`** (for example `ledger-v4` to
`ledger-v5`). That is what makes phones that already installed the app fetch
the whole new release together.

Sync starts the private repository's `butler.yml` workflow through GitHub's
API (`dry_run` set to `"false"`; a rehearsal sends `"true"`), watches that run
until it finishes, then re-reads `state/app-data.json`. That is why the key
needs **Actions: Read and write**.

Ask starts the private repository's `ask.yml` workflow the same way, with the
question, an id the app makes for it (`ask_id`) and `fresh` (`"true"` after
Start afresh). It finds that run by the id in the run's title, waits for it to
finish (giving up politely after about four minutes, with a link to the run),
then reads the answer from `state/conversation.json`. The question waiting for
its answer is kept in the phone's browser storage, so it survives closing the
app. No new permissions: the same key (Contents, Issues and Actions, all
"Read and write") covers it.

The file formats it reads are described in `docs/data-format.md` in the private
`Hevy-Butler` repository. `settings_schema.json` here is a fallback copy of
`butler/settings_schema.json` from that repository.
