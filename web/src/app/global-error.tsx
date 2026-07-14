"use client";

/**
 * Root error boundary — only fires when the ROOT layout itself throws, so
 * it must render its own <html>/<body> and cannot rely on globals.css or
 * Tailwind classes (the app shell never mounted). Everything is inlined.
 */

import { describeError } from "@/lib/errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#09090b",
          color: "#e4e4e7",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
          margin: 0,
        }}
      >
        <main
          style={{
            maxWidth: 640,
            margin: "0 auto",
            padding: "80px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
            the whole thing collapsed
          </h1>
          <p style={{ color: "#a1a1aa", fontSize: 14, margin: 0 }}>
            S#!thole hit an error it couldn&apos;t recover from. Reload — and if
            it persists, copy the details below and send them over.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 11,
              color: "#a1a1aa",
              background: "#18181b",
              border: "1px solid #3f1d1d",
              borderRadius: 8,
              padding: "10px 12px",
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {describeError(error)}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              alignSelf: "flex-start",
              background: "#0369a1",
              color: "#fff",
              border: 0,
              borderRadius: 6,
              padding: "10px 16px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            reload
          </button>
        </main>
      </body>
    </html>
  );
}
