"use client";

import { useEffect, useRef, useState } from "react";
import { loginWithGoogle, type MeResponse } from "@/lib/api";
import { loadGoogleIdentity } from "@/lib/google-gis";
import { cn } from "@/lib/utils";

type GoogleSignInProps = {
  clientId: string;
  onSignedIn: (me: MeResponse) => void;
  size?: "medium" | "large";
  className?: string;
};

export function GoogleSignIn({
  clientId,
  onSignedIn,
  size = "medium",
  className,
}: GoogleSignInProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSignedInRef = useRef(onSignedIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    if (!clientId || !hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;
    host.replaceChildren();
    setError(null);
    void loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !host.isConnected) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          auto_select: false,
          // Classic popup flow: the popup delivers the credential via
          // window.opener.postMessage, which our `same-origin-allow-popups` COOP
          // header permits. FedCM is intentionally NOT used here — when it half-
          // engages it silently drops the credential (button "succeeds" but our
          // callback never fires and nothing is stored).
          use_fedcm_for_prompt: false,
          callback: async (response) => {
            if (!response.credential) {
              setError("Google did not return a sign-in credential.");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const me = await loginWithGoogle(response.credential);
              onSignedInRef.current(me);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Google sign-in failed");
            } finally {
              setBusy(false);
            }
          },
        });
        google.accounts.id.renderButton(host, {
          type: "standard",
          theme: "outline",
          size,
          text: "signin_with",
          shape: "pill",
          logo_alignment: "left",
          width: size === "large" ? 280 : 220,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Google sign-in failed to load");
        }
      });
    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel?.();
    };
  }, [clientId, size]);

  if (!clientId) {
    return (
      <p className="text-sm text-[var(--ink-muted)]">
        Google sign-in is not configured for this origin.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <div
        ref={hostRef}
        data-testid="google-sign-in"
        className={cn("min-h-10 min-w-[220px]", size === "large" && "min-h-11 min-w-[280px]")}
      />
      {busy ? <p className="text-xs text-[var(--ink-muted)]">Signing in…</p> : null}
      {error ? <p className="max-w-xs text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
