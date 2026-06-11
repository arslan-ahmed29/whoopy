# whoopy

A personal WHOOP dashboard built on the official [WHOOP Developer API](https://developer.whoop.com). It shows your recovery, HRV, resting heart rate, sleep stages, daily strain, and recent workouts — all pulled live from your own WHOOP account via OAuth.

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20Chart.js-blue)

## What you need

1. **A WHOOP membership** with data in your account (any WHOOP band works — the API serves processed data from WHOOP's cloud, so this is not tied to a specific band generation).
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
