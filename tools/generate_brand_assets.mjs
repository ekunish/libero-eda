import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const brandDirectory = join(repositoryRoot, "public", "brand");
const markPath = join(brandDirectory, "libero-eda-mark.svg");

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { flag: "wx" });
  await rename(temporary, path);
}

async function renderPng(svg, width, height = width, options = {}) {
  let pipeline = sharp(svg, { density: 384 }).resize(width, height, { fit: "fill" });
  if (options.flatten) pipeline = pipeline.flatten({ background: options.flatten });
  return pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();
}

function createIco(entries) {
  const headerSize = 6;
  const directorySize = entries.length * 16;
  const header = Buffer.alloc(headerSize + directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let payloadOffset = header.length;
  entries.forEach(({ size, png }, index) => {
    const offset = headerSize + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, offset);
    header.writeUInt8(size === 256 ? 0 : size, offset + 1);
    header.writeUInt8(0, offset + 2);
    header.writeUInt8(0, offset + 3);
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(png.length, offset + 8);
    header.writeUInt32LE(payloadOffset, offset + 12);
    payloadOffset += png.length;
  });
  return Buffer.concat([header, ...entries.map((entry) => entry.png)]);
}

function maskableSvg(mark) {
  const encoded = Buffer.from(mark).toString("base64");
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" fill="#214b43"/>
      <image href="data:image/svg+xml;base64,${encoded}" x="51" y="51" width="410" height="410"/>
    </svg>
  `);
}

function socialCardSvg(mark) {
  const encodedMark = Buffer.from(mark).toString("base64");
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
          <stop stop-color="#f8f7f3"/>
          <stop offset="1" stop-color="#e8eee9"/>
        </linearGradient>
        <linearGradient id="route" x1="476" y1="526" x2="1100" y2="344" gradientUnits="userSpaceOnUse">
          <stop stop-color="#f24a49"/>
          <stop offset=".2" stop-color="#f2c94c"/>
          <stop offset=".4" stop-color="#65c466"/>
          <stop offset=".6" stop-color="#39b9c7"/>
          <stop offset=".8" stop-color="#596ad8"/>
          <stop offset="1" stop-color="#d24caf"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <g opacity=".22" stroke="#6f8179" stroke-width="1">
        <path d="M0 126h1200M0 252h1200M0 378h1200M0 504h1200"/>
        <path d="M240 0v630M480 0v630M720 0v630M960 0v630"/>
      </g>
      <image href="data:image/svg+xml;base64,${encodedMark}" x="76" y="72" width="112" height="112"/>
      <text x="76" y="288" fill="#18352f" font-family="Arial, Helvetica, sans-serif" font-size="82" font-weight="700" letter-spacing="-3">LIBERO EDA</text>
      <text x="80" y="350" fill="#52625c" font-family="Arial, Helvetica, sans-serif" font-size="28">Robot demonstrations, training trajectories,</text>
      <text x="80" y="390" fill="#52625c" font-family="Arial, Helvetica, sans-serif" font-size="28">and evaluation conditions — explored together.</text>
      <g fill="#214b43" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="600">
        <text x="80" y="492">RECORDED DATA</text><text x="270" y="492">EVALUATION</text><text x="424" y="492">REPLAY</text>
      </g>
      <path d="M480 520c125 14 257-4 366-54 92-42 168-101 232-177" fill="none" stroke="#18352f" stroke-width="28" stroke-linecap="round" opacity=".16"/>
      <path d="M480 520c125 14 257-4 366-54 92-42 168-101 232-177" fill="none" stroke="url(#route)" stroke-width="15" stroke-linecap="round"/>
      <circle cx="1078" cy="289" r="27" fill="#e8eee9" stroke="url(#route)" stroke-width="11"/><circle cx="1078" cy="289" r="7" fill="#214b43"/>
      <text x="80" y="570" fill="#6b7772" font-family="Arial, Helvetica, sans-serif" font-size="20">Original LIBERO · LIBERO-Plus</text>
      <text x="1120" y="570" text-anchor="end" fill="#214b43" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">by ekunish</text>
    </svg>
  `);
}

async function assertPng(buffer, width, height) {
  const metadata = await sharp(buffer).metadata();
  if (metadata.format !== "png" || metadata.width !== width || metadata.height !== height) {
    throw new Error(
      `Generated PNG is ${metadata.format} ${metadata.width}x${metadata.height}; expected PNG ${width}x${height}.`,
    );
  }
}

const mark = await readFile(markPath);
const outputs = [
  ["icon-192.png", await renderPng(mark, 192), 192, 192],
  ["icon-512.png", await renderPng(mark, 512), 512, 512],
  ["icon-maskable-512.png", await renderPng(maskableSvg(mark), 512), 512, 512],
  ["apple-touch-icon.png", await renderPng(mark, 180, 180, { flatten: "#214b43" }), 180, 180],
  ["social-card.png", await renderPng(socialCardSvg(mark), 1200, 630), 1200, 630],
];

for (const [name, buffer, width, height] of outputs) {
  await assertPng(buffer, width, height);
  await writeAtomic(join(brandDirectory, name), buffer);
}

const faviconEntries = await Promise.all(
  [16, 32, 48, 256].map(async (size) => ({ size, png: await renderPng(mark, size) })),
);
await writeAtomic(join(repositoryRoot, "public", "favicon.ico"), createIco(faviconEntries));

console.log("Generated LIBERO EDA brand assets.");
