/**
 * Cloudflare Worker entry. Two API routes; everything else is served from the
 * static assets binding (the built public/ directory).
 */
import { matrixGet, matrixPost } from "./api/matrix.js";
import { calendarGet } from "./api/calendar.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/matrix") {
      return request.method === "POST" ? matrixPost(request, env) : matrixGet(env);
    }
    if (pathname === "/api/calendar") return calendarGet(request);
    return env.ASSETS.fetch(request);
  },
};
