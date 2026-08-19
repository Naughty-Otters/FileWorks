function allowedOrigin(request) {
  const origin = request.headers.get("Origin") || "";
  if (
    /^https:\/\/(www\.)?(staging\.)?fileworks\.ai$/.test(origin) ||
    /^https:\/\/([a-z0-9-]+\.)?fileworks-(staging|prod)\.pages\.dev$/.test(origin) ||
    /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return origin;
  }
  return "";
}

function corsHeaders(request) {
  const origin = allowedOrigin(request);
  if (!origin) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") || "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  };
}

function jsonError(request, status, detail) {
  return Response.json({ detail }, { status, headers: corsHeaders(request) });
}

function withCors(request, response) {
  if (!response || typeof response.headers?.has !== "function") {
    return jsonError(request, 502, "API origin returned an empty response");
  }
  if (response.headers.has("Access-Control-Allow-Origin")) {
    return response;
  }
  const extra = corsHeaders(request);
  if (!Object.keys(extra).length) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function upstreamInit(request) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return init;
}

export default {
  async fetch(request, env) {
    const origin = String(env.ORIGIN || "").replace(/\/$/, "");
    if (!origin) {
      return jsonError(request, 502, "API origin is not configured");
    }
    const incoming = new URL(request.url);
    const target = new URL(`${incoming.pathname}${incoming.search}`, `${origin}/`);
    try {
      return withCors(request, await fetch(target.toString(), upstreamInit(request)));
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : "API origin timed out or was unreachable";
      return jsonError(request, 504, `API origin unreachable: ${detail}`);
    }
  },
  // Account ConcurrentExecutions=10 blocks provisioned concurrency. Ping the
  // Function URL so INIT is not on the first browser request.
  async scheduled(_event, env) {
    const origin = String(env.ORIGIN || "").replace(/\/$/, "");
    if (!origin) {
      return;
    }
    await fetch(`${origin}/api/health`);
  },
};
