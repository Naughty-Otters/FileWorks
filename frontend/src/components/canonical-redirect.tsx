"use client";

import { useEffect } from "react";
import { canonicalRedirectTarget } from "@/lib/runtime-config";

/**
 * Sends off-canonical hosts (Pages preview + www alias) to the stable origin.
 * Sign-in and CORS are only ever configured for that origin.
 */
export function CanonicalRedirect() {
  useEffect(() => {
    const target = canonicalRedirectTarget();
    if (target) window.location.replace(target);
  }, []);
  return null;
}
