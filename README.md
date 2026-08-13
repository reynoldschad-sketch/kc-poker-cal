# Poker Radar KC — Cloudflare Worker

Tournament calendar for poker within four hours of Kansas City. One Worker with a
static-assets binding. No framework.

```
kc-poker-cal/
├─ wrangler.jsonc      name, entry point, assets binding
├─ template.html       the app. Fonts inlined. Contains the token /*__DATA__*/
├─ data/poker.json     venues, events, weekly rules, sources
├─ build.mjs           data → public/index.html + public/calendar.ics
├─ src/
│  ├─ index.js         router: /api/* to handlers, everything else to ASSETS
│  └─ api/
│     ├─ matrix.js     POST geocode + routed drive times · GET self-test
│     └─ calendar.js   GET live filtered iCalendar feed
└─ public/             build output (gitignored) + _headers (committed)
```

## Deploy

**Workers Builds (git-connected, auto-deploys on push):**
Workers & Pages → Create → Workers → Import a repository → pick `kc-poker-cal`.

| Field | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**CLI:**

```bash
npm install
npx wrangler login
npm run deploy          # builds, then deploys
```

## Real drive times

Without a key the app falls back to a calibrated distance model and the header badge
reads ESTIMATED. To get ROUTED:

1. Google Cloud: enable **Geocoding API** and **Routes API**.
2. Create a key, restrict it to those two APIs, set a daily quota cap. You cannot
   IP-restrict it because Cloudflare's egress IPs aren't fixed.
3. Add the secret:
   ```bash
   npx wrangler secret put GOOGLE_MAPS_KEY
   ```
   Or in the dashboard: Worker → Settings → Variables and Secrets → add as **Secret**.
4. Redeploy. Secrets only attach to deployments made after they are set.

**Self-test:** open `https://<your-worker>/api/matrix` in a browser. It reports whether
the key is bound and which of the two Google APIs is failing. It never echoes the key.

The key stays server-side. The browser POSTs only the typed address string. No geolocation
permission, nothing in the URL bar. Results cache at the edge for a week per address and
in localStorage, so a repeat visit costs zero API calls.

Routing uses `TRAFFIC_UNAWARE` (free-flow). Switch to `TRAFFIC_AWARE` in
`src/api/matrix.js` for live conditions, at a higher per-call cost.

## Google Calendar

Subscribe (stays current) — Google Calendar → Other calendars → **From URL**:

```
https://<your-worker>/calendar.ics                        everything, KC + 4hr ring
https://<your-worker>/api/calendar?tier=kc&min=0          KC only, dailies included
https://<your-worker>/api/calendar?tier=kc,ring&min=250   the original brief
https://<your-worker>/api/calendar?min=500&dailies=0      majors only
https://<your-worker>/api/calendar?series=WSOP%20Circuit  one tour
```

Params: `tier` (`kc`,`ring`,`stretch`), `min` (buy-in floor), `series`, `dailies=0`.

Subscribe to a filtered feed, not everything. Google decides its own re-poll interval,
commonly 8 to 24 hours, and that is not adjustable from this end.

The header button downloads a one-time snapshot of the current filters instead. It never
updates again.

## Updating data

Edit `data/poker.json`, commit, push. Workers Builds rebuilds and redeploys.

Every event carries `conf` (`certain` / `likely` / `guessing`) and a `verified` date, both
surfaced in the UI. Weekly dailies live in `recurring` as day-of-week rules, projected 120
days out, auto-downgraded to `likely` past 35 days.

**The refresh rule that matters:** diff and merge into the existing JSON, never rebuild
from scratch. If a source errors or returns nothing, keep its existing events and mark the
source `warn`. Deleting on an empty read is how one broken scrape silently wipes a calendar.

Source traps and open items live in the Claude project doc `claude/poker-radar/README.md`.

## Local

```bash
npm run dev     # builds, then serves on :8787 with the assets binding
```

Put the key in a gitignored `.dev.vars` for local API testing:

```
GOOGLE_MAPS_KEY=...
```
