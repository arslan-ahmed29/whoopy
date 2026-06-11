# whoopy

A personal WHOOP dashboard that shows your recovery, HRV, resting heart rate, sleep, daily strain, stress, SpO2, skin temperature, and recent workouts — with two interchangeable data sources:

1. **Local mode (no membership needed)** — your band syncs over your computer's Bluetooth via the [openwhoop](https://github.com/bWanShiTong/openwhoop) CLI; all data stays on your machine.
2. **Cloud mode** — the official [WHOOP Developer API](https://developer.whoop.com) via OAuth (requires an active membership).

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20Chart.js-blue)

## Local mode — no membership, no cloud

This works like [goose](https://github.com/b-nnett/goose): the band is read directly over Bluetooth and metrics are computed locally. WHOOP 4.0 is fully supported by openwhoop; WHOOP 5.0/MG support exists in openwhoop (Gen5 sync) but is newer and less battle-tested.

You need: a computer with Bluetooth LE (Linux or macOS), [Rust](https://rustup.rs), and Node.js >= 22.5.

```sh
# 1. Install and run openwhoop (one-time setup)
git clone https://github.com/bWanShiTong/openwhoop
cd openwhoop
cp .env.example .env
cargo run -r -- scan                  # find your band; put its address/name in .env under WHOOP
cargo run -r -- download-history      # sync raw data from the band (slow the first time)
cargo run -r -- detect-events         # compute sleep, HRV, activities
cargo run -r -- calculate-stress      # optional: stress scores

# 2. Run the dashboard (in this repo)
npm install
npm start                             # auto-detects ~/.openwhoop/db.sqlite
```

Open <http://localhost:3000> — no login needed. Re-run `download-history` + `detect-events` whenever you want fresh data. Set `OPENWHOOP_DB` in `.env` if your database lives elsewhere.

In local mode the dashboard shows recovery (sleep score, HRV, resting HR), sleep duration, daily strain, workouts with heart-rate stats, plus a stress/SpO2/skin-temperature chart. Sleep-stage breakdowns and calories are cloud-API-only for now.

## Cloud mode — official WHOOP API

### What you need

1. **A WHOOP membership** with data in your account.
2. **A WHOOP developer app** — free to create:
   - Go to the [WHOOP Developer Dashboard](https://developer.whoop.com) and sign in with your WHOOP account.
   - Create a Team (if prompted), then create an App.
   - Set the **Redirect URL** to `http://localhost:3000/auth/callback`.
   - Enable scopes: `read:profile`, `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:body_measurement`, `offline`.
   - Copy the **Client ID** and **Client Secret** it gives you.

## Setup

```sh
git clone https://github.com/arslan-ahmed29/whoopy.git
cd whoopy
npm install
cp .env.example .env
# edit .env and paste in your Client ID and Client Secret
npm start
```

Open <http://localhost:3000>, click **Connect WHOOP**, and authorize the app. Your tokens are stored locally in `.tokens.json` (gitignored) and refreshed automatically.

## What it shows

| Surface | Source endpoint |
| --- | --- |
| Recovery score, HRV, resting HR (cards + trend charts) | `GET /developer/v2/recovery` |
| Sleep performance + stacked sleep-stage chart | `GET /developer/v2/activity/sleep` |
| Daily strain card + trend chart | `GET /developer/v2/cycle` |
| Recent workouts table (sport, duration, strain, HR, calories) | `GET /developer/v2/activity/workout` |
| Your name in the header | `GET /developer/v2/user/profile/basic` |

Use the date-range selector (7/30/90 days) to change the trend window.

## Architecture

- `server.js` — Express server that handles the OAuth 2.0 authorization-code flow, persists/refreshes tokens, and proxies WHOOP API calls (so your Client Secret never reaches the browser).
- `public/` — static frontend: vanilla JS + [Chart.js](https://www.chartjs.org/) from a CDN, no build step.

## Privacy

Everything runs locally. Your health data goes from WHOOP's API to your machine and nowhere else. Never commit `.env` or `.tokens.json`.

## Notes

- whoopy is an independent project and is not affiliated with WHOOP.
- If WHOOP changes its API, the base URL and endpoints are defined at the top of `server.js`.
