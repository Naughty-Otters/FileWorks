export default {
  async fetch(request, env) {
    const origin = String(env.ORIGIN || "").replace(/\/$/, "");
    if (!origin) {
      return new Response("API origin is not configured", { status: 502 });
    }
    const incoming = new URL(request.url);
    const target = new URL(`${incoming.pathname}${incoming.search}`, `${origin}/`);
    return fetch(target, request);
  },
};
