/**
 * GET /api/calendar?tier=kc,ring&min=250&series=WSOP%20Circuit
 * A live iCalendar feed. Subscribe to it once in Google Calendar ("From URL") and it
 * keeps itself current, instead of a one-time .ics import that goes stale.
 *
 * Google re-polls subscribed URLs on its own schedule, commonly 8 to 24 hours. That is
 * Google's cadence, not something this feed controls.
 */
import DATA from "../../data/poker.json";

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const tiers = new Set((q.get("tier") || "kc,ring").split(",").filter(Boolean));
  const min = parseInt(q.get("min") || "0", 10) || 0;
  const series = q.get("series");
  const dailies = q.get("dailies") !== "0";

  const V = Object.fromEntries(DATA.venues.map(v => [v.id, v]));
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];

  for (const e of DATA.events) {
    const v = V[e.venue]; if (!v) continue;
    if (!tiers.has(v.tier)) continue;
    if (min && (e.buyin == null || e.buyin < min)) continue;
    if (series && e.series !== series) continue;
    if ((e.end || e.date) < today) continue;
    rows.push({ ...e, v, uid: e.id });
  }
  if (dailies) {
    const end = new Date(Date.now() + 120 * 864e5);
    DATA.recurring.forEach((r, ri) => {
      const v = V[r.venue]; if (!v || !tiers.has(v.tier)) return;
      if (min && (r.buyin == null || r.buyin < min)) return;
      if (series && r.series !== series) return;
      const d = new Date();
      while (d.getDay() !== r.dow) d.setDate(d.getDate() + 1);
      while (d <= end) {
        const iso = d.toISOString().slice(0, 10);
        rows.push({ ...r, v, date: iso, end: null, uid: "r" + ri + "_" + iso });
        d.setDate(d.getDate() + 7);
      }
    });
  }
  rows.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

  const out = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Poker Radar KC//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", "X-WR-CALNAME:Poker Radar KC", "X-WR-TIMEZONE:America/Chicago",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  const ds = s => s.replace(/-/g, ""), pad = n => String(n).padStart(2, "0");
  for (const e of rows) {
    let dt, de;
    if (e.time) {
      const [h, m] = e.time.split(":").map(Number);
      dt = "DTSTART;TZID=America/Chicago:" + ds(e.date) + "T" + pad(h) + pad(m) + "00";
      de = "DTEND;TZID=America/Chicago:" + ds(e.date) + "T" + pad(Math.min(h + 5, 23)) + pad(m) + "00";
    } else {
      dt = "DTSTART;VALUE=DATE:" + ds(e.date);
      const x = new Date(e.end || e.date); x.setDate(x.getDate() + 1);
      de = "DTEND;VALUE=DATE:" + ds(x.toISOString().slice(0, 10));
    }
    const money = n => "$" + n.toLocaleString();
    out.push("BEGIN:VEVENT", "UID:" + e.uid + "@poker-radar", dt, de,
      "SUMMARY:" + esc(e.name + (e.buyin ? " (" + money(e.buyin) + ")" : "")),
      "LOCATION:" + esc(e.v.name + ", " + e.v.city + ", " + e.v.state),
      "DESCRIPTION:" + esc([
        e.series && "Series: " + e.series,
        e.gtd && "Guarantee: " + money(e.gtd),
        e.stack && "Stack: " + e.stack.toLocaleString(),
        e.blinds && e.blinds + " min levels",
        e.v.phone, e.note, e.src,
      ].filter(Boolean).join("\n")),
      "END:VEVENT");
  }
  out.push("END:VCALENDAR");

  return new Response(out.join("\r\n"), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="poker-radar-kc.ics"',
      "cache-control": "public, max-age=3600",
    },
  });
}
const esc = s => String(s).replace(/[\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
