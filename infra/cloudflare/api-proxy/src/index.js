function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") || "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  };
}

export default {
  async fetch(request, env) {
    const origin = String(env.ORIGIN || "").replace(/\/$/, "");
    if (!origin) {
      return new Response("API origin is not configured", {
        status: 502,
        headers: corsHeaders(request),
      });
    }
    const incoming = new URL(request.url);
    const target = new URL(`${incoming.pathname}${incoming.search}`, `${origin}/`);
    try {
      return await fetch(target, request);
    } catch (err) {
      // Origin dropped the connection (timeout, reset). Answer with CORS so the
      // browser shows a 504 instead of a generic "blocked by CORS" error.
      const detail =
        err instanceof Error ? err.message : "API origin timed out or was unreachable";
      return Response.json(
        { detail: `API origin unreachable: ${detail}` },
        { status: 504, headers: corsHeaders(request) },
      );
    }
  },
};
