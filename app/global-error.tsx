"use client";

const surfaceStyle = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  color: "#f5f5f5",
  background: "#111111",
  fontFamily:
    'Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <main style={surfaceStyle}>
          <section
            aria-labelledby="global-error-title"
            style={{ maxWidth: 420, textAlign: "center" }}
          >
            <h1
              id="global-error-title"
              style={{ margin: 0, fontSize: 20, fontWeight: 600 }}
            >
              RIFT needs a quick restart
            </h1>
            <p
              role="alert"
              style={{
                margin: "10px 0 22px",
                color: "#a3a3a3",
                lineHeight: 1.6,
              }}
            >
              The application shell could not load. Your saved work was not
              changed.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 38,
                padding: "0 16px",
                border: "1px solid #3f3f46",
                borderRadius: 8,
                color: "#111111",
                background: "#f5f5f5",
                font: "inherit",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload RIFT
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
