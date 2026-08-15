"use client";

import { useEffect } from "react";
import { canonicalRedirectTarget } from "@/lib/runtime-config";

/**
 * Sends per-deployment Pages preview hosts to the stable origin. Sign-in and CORS
 * are only ever configured for that origin, so a preview host is a dead end.
 */
export function CanonicalRedirect() {
  useEffect(() => {
    const target = canonicalRedirectTarget();
    if (target) window.location.replace(target);
  }, []);
  return null;
}
