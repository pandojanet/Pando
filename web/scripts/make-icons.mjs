/**
 * Regenerates the two raster icons from the Pando mark.
 *
 *   node scripts/make-icons.mjs
 *
 *   app/favicon.ico    legacy + link-preview fallback (16/32/48, PNG-in-ICO)
 *   app/apple-icon.png iOS "Add to Home Screen" (180x180)
 *
 * `app/icon.svg` is the real tab icon and is hand-written — it carries a
 * prefers-color-scheme branch that no raster format can. These two exist for the
 * places that cannot read it: Safari on iOS ignores SVG icons for the home screen,
 * and a handful of crawlers, feed readers and link unfurlers request /favicon.ico
 * directly without looking at <link> at all.
 *
 * A binary in the repo with no way to rebuild it is a brand asset that quietly goes
 * stale, which is why this script exists rather than two committed blobs. Run it
 * after any change to the mark or the palette.
 */

import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const PAPER = "#f7f6f0";
const LEAF = "#587a4a";
const DOTS = "#223018";

/**
 * The leaf path is copied verbatim from components/ui/Logo.tsx — keep them
 * identical. `scale` differs per output: iOS rounds the corners of its icons, so the
 * touch icon needs more room than a tab icon does.
 *
 * Both raster outputs are opaque on paper, and deliberately so. The SVG can be
 * transparent because it also knows how to recolour itself for dark chrome; these
 * land in contexts that do neither, and ink dots on an unknown dark background are
 * invisible. A small paper tile is the robust answer, not the pretty one.
 */
function markSvg({ scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${PAPER}"/>
  <g transform="translate(16 16) scale(${scale}) translate(-13 -14.95)">
    <path d="M13 2C9 6.5 7.5 9.5 7.5 12.5C7.5 16 10 18.5 13 18.5C16 18.5 18.5 16 18.5 12.5C18.5 9.5 17 6.5 13 2Z" fill="${LEAF}"/>
    <path d="M13 17V21.4" stroke="${LEAF}" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="6.9" cy="25.7" r="2.2" fill="${DOTS}"/>
    <circle cx="13" cy="25.7" r="2.2" fill="${DOTS}"/>
    <circle cx="19.1" cy="25.7" r="2.2" fill="${DOTS}"/>
  </g>
</svg>`;
}

/**
 * `keepAlpha` is not cosmetic — it decides whether the build works.
 *
 * Turbopack reads app/favicon.ico to work out its dimensions, and the ICO decoder it
 * uses refuses any embedded PNG that is not RGBA ("The PNG is not in RGBA format!"),
 * which takes the whole dev server down with it. So the ICO's images keep an alpha
 * channel even though `flatten` has already made every pixel opaque.
 *
 * apple-icon.png is the opposite case: nothing parses it, and a touch icon that
 * *can* be transparent is one bad export away from a black square on somebody's home
 * screen — so there the channel is dropped for good.
 */
const png = (svg, size, { keepAlpha = false } = {}) => {
  const pipeline = sharp(Buffer.from(svg), { density: 640 })
    .resize(size, size)
    .flatten({ background: PAPER });
  return (keepAlpha ? pipeline.ensureAlpha(1) : pipeline)
    .png({ compressionLevel: 9 })
    .toBuffer();
};

/**
 * An ICO is a 6-byte header, one 16-byte directory entry per image, then the image
 * blobs. Embedding PNG rather than BMP is legal and understood everywhere that still
 * asks for a .ico, and it avoids hand-rolling a bottom-up BMP with its own alpha
 * mask. sharp cannot write the container, so we write it here.
 */
function ico(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon (2 would be a cursor)
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(ENTRY);
    // 256 is stored as 0; we never go that big, but the rule is worth encoding.
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size — 0 for truecolour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const ICO_SIZES = [16, 32, 48];
const icoSvg = markSvg({ scale: 1.05 });
const images = await Promise.all(
  ICO_SIZES.map(async (size) => ({
    size,
    data: await png(icoSvg, size, { keepAlpha: true }),
  })),
);
await writeFile("app/favicon.ico", ico(images));
console.log(`wrote app/favicon.ico (${ICO_SIZES.join("/")})`);

await writeFile("app/apple-icon.png", await png(markSvg({ scale: 0.92 }), 180));
console.log("wrote app/apple-icon.png at 180x180");
