// Rewritten by `fw frontend` from the Terraform `api_url` output.
// Empty apiUrl falls back to NEXT_PUBLIC_API_URL, then http://127.0.0.1:8000.
// Empty canonicalOrigin disables the preview-host redirect (correct for local dev).
window.__FILEWORKS_CONFIG__ = { apiUrl: "", canonicalOrigin: "" };
