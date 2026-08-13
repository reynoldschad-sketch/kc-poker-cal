# Poker Radar KC — Cloudflare Pages

A single-page tournament calendar for poker within four hours of Kansas City.
Static HTML plus two Pages Functions. No framework, no build step beyond one Node script.

```
poker-radar/
├─ template.html          the app. Fonts already inlined. Contains the token /*__DATA__*/
├─ data/poker.json        the dataset: venues, events, weekly rules, sources
├─ build.mjs              injects data into template → public/index.html + public/calendar.ics
├─ package.json           "build": "node build.mjs"
├─ functions/
│  └─ api/
│     ├─ matrix.js        POST /api/matrix   → geocode an address + real routed drive times
│     └─ calendar.js      GET  /api/calendar → live filtered iCalendar feed
└─ public/                BUILD OUTPUT, gitignored
   ├─ index.html
   ├─ calendar.ics        static unfiltered feed, works with no Functions
   └─ _headers            committed, not generated
```

`public/index.html` and `public/calendar.ics` are gitignored on purpose. Cloudflare
regenerates them on every deploy. `public/_headers` is committed.

---

## Deploy

**Pages settings**

| Field | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `public` |
| Root directory | `/` |

Functions are picked up from `/functions` automatically. Nothing to configure.

CLI instead of git, run from the repo root so `functions/` is included:

```bash
npm run build && npx wrangler pages deploy public
```

**Direct Upload instead of git:** `npm run build:dragdrop` emits `dist/`, which bundles
both API routes into a single `_worker.js`. Drag that folder onto Pages → Direct Upload.
Note that `_worker.js` and `functions/` are mutually exclusive: if Pages sees `_worker.js`
it ignores `functions/` entirely. A Pages project also cannot be switched between Direct
Upload and git after creation. Delete and recreate the project to change modes.

**That's it.** Deployed with no API key, the site works: drive times fall back to the
built-in distance model and the badge next to the home button reads `ESTIMATED`.
Everything below is what turns that into `ROUTED`.

---

## Real drive times

1. In Google Cloud, enable two APIs on your project: **Geocoding API** and **Routes API**.
2. Create an API key.
3. Restrict it to those two APIs only, and set a daily quota cap. You cannot IP-restrict
   it, because Cloudflare's egress IPs aren't fixed. The API restriction plus a quota cap
   is the real protection.
4. In Pages → Settings → Environment variables, add a **secret** (not a plaintext variable)
   named `GOOGLE_MAPS_KEY`. Add it to both Production and Preview.
5. **Create a new deployment.** Environment variables only attach to deployments made
   *after* they are set. An existing deployment will not pick up a newly added secret.

**Check it worked:** open `https://<your-site>/api/matrix` in a browser. That GET route is
a self-test that reports whether the key is bound and which of the two Google APIs is
failing. It never echoes the key.

The key never reaches the browser. The flow is: you type an address → the browser POSTs
just that string to `/api/matrix` → the Function geocodes it and runs one route matrix
against all 22 venues → it returns minutes and miles per venue. No geolocation permission,
no location sharing, nothing in the URL bar.

Results are cached at Cloudflare's edge for a week keyed on the address, and in
localStorage in your browser. A repeat visit from the same address costs zero API calls.
Changing your address is two calls: one geocode, one matrix. Personal use will not get
near a sane quota cap.

Routing uses `TRAFFIC_UNAWARE`, so you get a free-flow drive, not a right-now-in-traffic
drive. That's the right default for "is Tulsa a day trip." Switch it to `TRAFFIC_AWARE`
in `functions/api/matrix.js` if you'd rather see live conditions, which costs more per call.

---

## Google Calendar

Two ways in, and they are not the same thing.

**Subscribe (stays current).** Google Calendar → Other calendars → **From URL**:

```
https://<your-site>/calendar.ics                        everything in KC + 4 hours
https://<your-site>/api/calendar?tier=kc&min=0          KC only, dailies included
https://<your-site>/api/calendar?tier=kc,ring&min=250   your original brief
https://<your-site>/api/calendar?min=500&dailies=0      majors only, no dailies
https://<your-site>/api/calendar?series=WSOP%20Circuit  one tour
```

Params: `tier` (`kc`, `ring`, `stretch`, comma separated), `min` (buy-in floor),
`series`, `dailies=0`.

Subscribe to a filtered feed rather than everything. All 287 entries will bury your
calendar. Worth knowing: Google decides how often it re-polls a subscribed URL, commonly
somewhere between 8 and 24 hours, and that is not adjustable from this end. The feed
advertises a 6-hour refresh hint; Google may ignore it.

**Import (one-time snapshot).** The Add to Google Calendar button in the header downloads
whatever your current filters show. It never updates again. Use it for a one-off trip.

Make a separate "Poker" calendar for either path so you can hide it in one click.

---

## Updating the data

Edit `data/poker.json`, commit, push. Cloudflare rebuilds and redeploys.

Every event carries a `conf` field of `certain`, `likely`, or `guessing`, and a `verified`
date. Both surface in the UI. Don't upgrade a confidence tag without evidence.

Weekly dailies live in `recurring` as day-of-week rules rather than hundreds of dated rows,
and the app projects them 120 days out. Anything past 35 days is automatically downgraded
to `likely`, because rooms only publish a few weeks ahead.

**The refresh rule that matters:** when re-scraping sources, diff and merge into the
existing JSON. Never rebuild it from scratch. If a source errors or returns nothing, keep
its existing events and mark the source `warn`. Deleting on an empty read is how a single
broken scrape silently wipes a calendar.

Source list, per-source traps, and open items are in the project doc `claude/poker-radar/README.md`.

---

## Local

```bash
npm install -g wrangler   # once
npm run dev               # builds, then serves public/ with Functions on :8788
```

Functions need `GOOGLE_MAPS_KEY` locally too. Put it in a `.dev.vars` file at the repo
root (gitignored):

```
GOOGLE_MAPS_KEY=...
```

Without it `/api/matrix` returns 501 and the app falls back to the estimate model, which
is exactly what you want to test anyway.
