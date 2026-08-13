export type GoogleCredentialResponse = {
  credential: string;
};

export type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (opts: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        itp_support?: boolean;
        use_fedcm_for_prompt?: boolean;
        ux_mode?: "popup" | "redirect";
      }) => void;
      renderButton: (
        el: HTMLElement,
        opts: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "small" | "medium" | "large";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
        },
      ) => void;
      prompt?: () => void;
      cancel?: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";

let loadPromise: Promise<GoogleIdentity> | null = null;

export function resetGoogleIdentityLoaderForTests() {
  loadPromise = null;
}

export function resolveGoogleClientId(fromApi?: string | null): string {
  return (fromApi || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();
}

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Identity Services requires a browser"));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const onReady = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google);
        return;
      }
      loadPromise = null;
      reject(new Error("Google Identity Services failed to load"));
    };
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve(window.google);
        return;
      }
      existing.addEventListener("load", onReady);
      existing.addEventListener("error", () => {
        loadPromise = null;
        reject(new Error("Failed to load Google Identity Services"));
      });
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = onReady;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Google Identity Services"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}
