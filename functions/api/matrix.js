/**
 * POST /api/matrix
 * Body: { address: "805 W Gregory Blvd, Kansas City, MO", venues: [{id,lat,lon}, ...] }
 * Returns: { home:{lat,lon,label}, results: { <venueId>: {min, miles} } }
 *
 * The Google key lives in a Pages secret and never reaches the browser. No location
 * permission is involved: the user types an address, we geocode it server-side.
 * Responses are cached on Cloudflare's edge for a week, keyed by address, so a repeat
 * visitor costs zero API calls.
 */
const CACHE_SECONDS = 60 * 60 * 24 * 7;

/**
 * GET /api/matrix  — self-test. Reports which half of the setup is broken without
 * ever echoing the key. Safe to leave deployed: it exposes no secret material.
 */
export async function onRequestGet({ env }) {
  const key = env.GOOGLE_MAPS_KEY;
  const out = {
    keyPresent: !!key,
    keyLength: key ? key.length : 0,
    geocodingApi: "not tested",
    routesApi: "not tested",
    verdict: "",
  };
  if (!key) {
    out.verdict = "GOOGLE_MAPS_KEY is not bound to this deployment. Add it in Pages > Settings > Variables and secrets, then create a NEW deployment. Env vars only attach to deployments made after they are set.";
    return json(out);
  }
  // 1. Geocoding API
  try {
    const g = await fetch("https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent("805 W Gregory Blvd, Kansas City, MO") + "&key=" + key).then(r => r.json());
    out.geocodingApi = g.status + (g.error_message ? " — " + g.error_message : "");
    if (g.status === "OK") {
      const l = g.results[0].geometry.location;
      // 2. Routes API
      const rm = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition" },
        body: JSON.stringify({
          origins: [{ waypoint: { location: { latLng: { latitude: l.lat, longitude: l.lng } } } }],
          destinations: [{ waypoint: { location: { latLng: { latitude: 39.1178, longitude: -94.832 } } } }],
          travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
        }),
      });
      const body = await rm.text();
      out.routesApi = rm.ok ? "OK — " + body.slice(0, 160) : rm.status + " — " + body.slice(0, 300);
    }
  } catch (e) {
    out.geocodingApi = "fetch threw: " + e.message;
  }
  const gOK = out.geocodingApi.startsWith("OK");
  const rOK = String(out.routesApi).startsWith("OK");
  out.verdict = gOK && rOK
    ? "Both APIs working. The app should show ROUTED."
    : !gOK ? "Geocoding API is failing. Enable 'Geocoding API' on the Google Cloud project that owns this key, and make sure the key's API restrictions include it."
           : "Geocoding works, Routes API is failing. Enable 'Routes API' on the same project and add it to the key's API restrictions.";
  return json(out);
}

export async function onRequestPost({ request, env }) {
  const key = env.GOOGLE_MAPS_KEY;
  if (!key) return json({ error: "GOOGLE_MAPS_KEY is not set on this project" }, 501);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const address = (body.address || "").toString().trim();
  const venues = Array.isArray(body.venues) ? body.venues.slice(0, 25) : [];
  if (!address || !venues.length) return json({ error: "address and venues required" }, 400);

  // edge cache, keyed on the address plus the venue set
  const ck = new Request(
    "https://cache.internal/matrix?" +
      new URLSearchParams({ a: address, v: venues.map(v => v.id).sort().join(",") }),
    { method: "GET" }
  );
  const cache = caches.default;
  const hit = await cache.match(ck);
  if (hit) return hit;

  // 1. geocode the typed address
  const g = await fetch(
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(address) + "&key=" + key
  ).then(r => r.json());
  if (g.status !== "OK" || !g.results?.length) {
    return json({ error: "could not find that address", detail: g.status }, 404);
  }
  const loc = g.results[0].geometry.location;
  const label = shortLabel(g.results[0], address);

  // 2. one origin against every venue. Routes API caps a matrix at 625 elements; 22 is fine.
  const rm = await fetch(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: loc.lat, longitude: loc.lng } } } }],
        destinations: venues.map(v => ({
          waypoint: { location: { latLng: { latitude: v.lat, longitude: v.lon } } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE", // free-flow: a Tuesday-noon drive, not right now
      }),
    }
  );
  if (!rm.ok) return json({ error: "route matrix failed", detail: await rm.text() }, 502);

  const rows = await rm.json();
  const results = {};
  for (const row of rows) {
    if (row.condition && row.condition !== "ROUTE_EXISTS") continue;
    const v = venues[row.destinationIndex];
    if (!v) continue;
    results[v.id] = {
      min: Math.round(parseInt(row.duration, 10) / 60),
      miles: Math.round((row.distanceMeters || 0) / 1609.344),
    };
  }

  const res = json({ home: { lat: loc.lat, lon: loc.lng, label }, results });
  res.headers.set("cache-control", "public, max-age=" + CACHE_SECONDS);
  await cache.put(ck, res.clone());
  return res;
}

function shortLabel(r, fallback) {
  const c = r.address_components || [];
  const pick = t => c.find(x => x.types.includes(t))?.short_name;
  const city = pick("locality") || pick("sublocality") || pick("neighborhood");
  const st = pick("administrative_area_level_1");
  return city && st ? city + ", " + st : (fallback.split(",")[0] || fallback).trim();
}
function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
