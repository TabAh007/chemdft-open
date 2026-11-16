"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "flexible" | "compact";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export function TurnstileWidget({
  onVerify,
  onError,
  onExpire,
}: {
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(() => typeof window !== "undefined" && Boolean(window.turnstile));
  const [renderError, setRenderError] = useState(false);

  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onErrorRef.current = onError;
    onExpireRef.current = onExpire;
  });

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !scriptLoaded || !containerRef.current || widgetIdRef.current) return;

    if (!window.turnstile) {
      queueMicrotask(() => {
        setRenderError(true);
        onErrorRef.current?.();
      });
      return;
    }

    try {
      const widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          onVerifyRef.current(token);
        },
        "error-callback": () => {
          setRenderError(true);
          onErrorRef.current?.();
        },
        "expired-callback": () => {
          onExpireRef.current?.();
        },
        theme: "light",
      });
      widgetIdRef.current = widgetId;
    } catch {
      queueMicrotask(() => {
        setRenderError(true);
        onErrorRef.current?.();
      });
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, scriptLoaded]);

  if (!siteKey) {
    return (
      <div className="contact-turnstile-fallback" role="alert" style={{ color: "#d9381e", fontSize: "13px", padding: "8px 0" }}>
        The form is temporarily unavailable. Please email <a href="mailto:tab@chemdft.com">tab@chemdft.com</a>.
      </div>
    );
  }

  return (
    <div className="contact-turnstile-container" style={{ margin: "14px 0" }}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => {
          setRenderError(true);
          onError?.();
        }}
      />
      <div ref={containerRef} data-testid="turnstile-widget-slot" style={{ minHeight: "65px" }} />
      {renderError ? (
        <p className="contact-turnstile-error" role="alert" style={{ color: "#d9381e", fontSize: "12px", marginTop: "4px" }}>
          Security verification could not be loaded. Please email <a href="mailto:tab@chemdft.com">tab@chemdft.com</a>.
        </p>
      ) : null}
    </div>
  );
}
