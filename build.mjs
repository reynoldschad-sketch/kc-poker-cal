/**
 * Injects data/poker.json into template.html and writes public/index.html,
 * plus a static public/calendar.ics as a no-Functions fallback feed.
 * Run: npm run build   (Cloudflare Pages runs this automatically on every push)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const data = readFileSync("data/poker.json", "utf8");
const tpl = readFileSync("template.html", "utf8");
if (!tpl.includes("/*__DATA__*/")) throw new Error("template.html is missing the /*__DATA__*/ token");

mkdirSync("public", { recursive: true });
writeFileSync("public/index.html", tpl.replace("/*__DATA__*/", data));

// static fallback feed: KC + 4hr ring, everything, no filters
const D = JSON.parse(data);
const V = Object.fromEntries(D.venues.map(v => [v.id, v]));
const today = new Date().toISOString().slice(0, 10);
const esc = s => String(s).replace(/[\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
const ds = s => s.replace(/-/g, ""), pad = n => String(n).padStart(2, "0");
const rows = [];
for (const e of D.events) {
  const v = V[e.venue];
  if (!v || v.tier === "stretch" || (e.end || e.date) < today) continue;
  rows.push({ ...e, v, uid: e.id });
}
const end = new Date(Date.now() + 120 * 864e5);
D.recurring.forEach((r, ri) => {
  const v = V[r.venue]; if (!v) return;
  const d = new Date();
  while (d.getDay() !== r.dow) d.setDate(d.getDate() + 1);
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    rows.push({ ...r, v, date: iso, end: null, uid: "r" + ri + "_" + iso });
    d.setDate(d.getDate() + 7);
  }
});
rows.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
const out = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Poker Radar KC//EN","CALSCALE:GREGORIAN",
  "METHOD:PUBLISH","X-WR-CALNAME:Poker Radar KC","X-WR-TIMEZONE:America/Chicago",
  "REFRESH-INTERVAL;VALUE=DURATION:PT6H","X-PUBLISHED-TTL:PT6H"];
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
  out.push("BEGIN:VEVENT", "UID:" + e.uid + "@poker-radar", dt, de,
    "SUMMARY:" + esc(e.name + (e.buyin ? " ($" + e.buyin.toLocaleString() + ")" : "")),
    "LOCATION:" + esc(e.v.name + ", " + e.v.city + ", " + e.v.state),
    "DESCRIPTION:" + esc([e.series && "Series: " + e.series, e.gtd && "Guarantee: $" + e.gtd.toLocaleString(),
      e.v.phone, e.src].filter(Boolean).join("\n")),
    "END:VEVENT");
}
out.push("END:VCALENDAR");
writeFileSync("public/calendar.ics", out.join("\r\n"));

console.log(`built public/index.html (${D.events.length} events, ${D.venues.length} venues) and public/calendar.ics (${rows.length} entries)`);
