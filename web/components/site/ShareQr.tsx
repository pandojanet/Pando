/**
 * A QR code that opens https://pando.is — on the home page so a parent can show
 * the site to another parent from their own screen (8 Oct, the developer).
 *
 * The modules are drawn here rather than generated in the browser: the address
 * never changes, so a QR library in the bundle would only re-derive this one
 * path on every visit. It was made once with `qrcode` 1.5.4 (error correction
 * M, no margin — the 25×25 grid of a version-2 code) and checked by decoding it
 * with `jsqr`, which read back exactly "https://pando.is". If the address ever
 * changes, regenerate it the same way and decode it again before shipping:
 *
 *     QR.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0 })
 *
 * ⚠ It draws in `currentColor` and has no background of its own: the caller
 * puts it on a light tile, which is also its quiet zone. A QR on the dark moss
 * band with no light margin round it does not scan reliably.
 */
const MODULES =
  "M0 0.5h7m1 0h1m1 0h2m1 0h3m2 0h7M0 1.5h1m5 0h1m1 0h1m2 0h5m2 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m1 0h2m2 0h3m3 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m4 0h2m1 0h3m1 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m1 0h4m1 0h1m1 0h1m2 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m3 0h2m1 0h2m3 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M9 7.5h1m2 0h1m1 0h2M0 8.5h1m2 0h7m1 0h1m1 0h3m1 0h1m2 0h1m1 0h3M2 9.5h1m6 0h2m3 0h2m3 0h5M0 10.5h1m4 0h2m2 0h1m2 0h1m1 0h5m1 0h2m2 0h1M0 11.5h2m1 0h2m2 0h1m1 0h2m3 0h1m1 0h1m1 0h1m2 0h4M1 12.5h1m1 0h2m1 0h3m1 0h1m2 0h2m1 0h1m1 0h1m5 0h1M0 13.5h3m2 0h1m1 0h3m2 0h1m2 0h2m3 0h1m2 0h1M0 14.5h2m1 0h2m1 0h2m1 0h2m3 0h4m2 0h5M0 15.5h1m1 0h1m4 0h1m4 0h4m3 0h1m1 0h2m1 0h1M0 16.5h1m1 0h1m1 0h3m1 0h1m2 0h2m3 0h5m1 0h2M8 17.5h1m1 0h2m4 0h1m3 0h1m1 0h2M0 18.5h7m1 0h3m1 0h3m1 0h1m1 0h1m1 0h1m3 0h1M0 19.5h1m5 0h1m1 0h1m1 0h2m1 0h1m2 0h1m3 0h1m3 0h1M0 20.5h1m1 0h3m1 0h1m1 0h2m1 0h1m1 0h1m1 0h6m3 0h1M0 21.5h1m1 0h3m1 0h1m1 0h1m3 0h2m1 0h1m1 0h2m4 0h2M0 22.5h1m1 0h3m1 0h1m2 0h3m1 0h1m2 0h2m2 0h5M0 23.5h1m5 0h1m2 0h5m4 0h3m1 0h3M0 24.5h7m1 0h2m1 0h3m2 0h3m2 0h1m2 0h1";

export function ShareQr({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 25 25"
      role="img"
      aria-label="QR code that opens pando.is"
      className={className}
      shapeRendering="crispEdges"
    >
      <path d={MODULES} fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}
