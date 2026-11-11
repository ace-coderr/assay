import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Reading } from "../lib/api";

const UNAVAILABLE_LABEL: Record<string, string> = {
  "no-pool": "No pool on Base yet",
  "pool-too-thin": "Pools too thin",
  "no-reference": "No reference value",
  "source-error": "Source error",
};

export function StateBadge({ r }: { r: Pick<Reading, "status" | "state"> & { unavailableCode?: string } }) {
  if (r.status !== "ok" || !r.state) {
    return <span className="badge unavailable">{(r.unavailableCode && UNAVAILABLE_LABEL[r.unavailableCode]) || "unavailable"}</span>;
  }
  return <span className={`badge ${r.state.toLowerCase()}`}>{r.state.toUpperCase()}</span>;
}

/** Fades content in when scrolled into view. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e && (e.isIntersecting || e.boundingClientRect.top < 0)) { setOn(true); io.disconnect(); } }, { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${on ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function SectionPill({ n, label }: { n: string; label: string }) {
  return (
    <span className="pill-n">
      <span>{n}</span>
      <span>{label}</span>
    </span>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 54 }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="banner" role="alert">
      Source unavailable: {error}. Nothing is shown in its place.{" "}
      {onRetry && (
        <button className="btn small" onClick={onRetry} style={{ marginLeft: 8 }}>
          Retry
        </button>
      )}
    </div>
  );
}

export const DISCLAIMER_TEXT =
  "Information only. Not financial advice. Assay does not trade, hold funds or endorse any token, venue or issuer, and is not endorsed by Base or by any token issuer.";

export function Disclaimer() {
  return <p className="notice">{DISCLAIMER_TEXT}</p>;
}

/** Copies text. Uses the Clipboard API, and falls back to a hidden textarea where it is refused. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyBlock({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy">
      <pre>{text}</pre>
      <button
        className="btn small"
        onClick={() => {
          void copyText(text).then((ok) => {
            setDone(ok);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? "Copied" : label}
      </button>
    </div>
  );
}
