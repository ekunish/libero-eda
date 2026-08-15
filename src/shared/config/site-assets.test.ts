import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const publicRoot = join(process.cwd(), "public");

async function expectPng(path: string, width: number, height: number) {
  const image = sharp(path);
  const metadata = await image.metadata();
  expect(metadata).toMatchObject({ format: "png", width, height });
  return image;
}

describe("brand assets", () => {
  it("ships the SVG source and exact raster sizes", async () => {
    const svg = await readFile(join(publicRoot, "brand", "libero-eda-mark.svg"), "utf8");
    expect(svg).toContain("LIBERO EDA");
    expect(svg).toContain("linearGradient");

    await expectPng(join(publicRoot, "brand", "apple-touch-icon.png"), 180, 180);
    await expectPng(join(publicRoot, "brand", "icon-192.png"), 192, 192);
    await expectPng(join(publicRoot, "brand", "icon-512.png"), 512, 512);
    await expectPng(join(publicRoot, "brand", "social-card.png"), 1200, 630);
  });

  it("keeps regular icon corners transparent and fills the maskable safe canvas", async () => {
    const regular = await expectPng(join(publicRoot, "brand", "icon-512.png"), 512, 512);
    const maskable = await expectPng(join(publicRoot, "brand", "icon-maskable-512.png"), 512, 512);
    const regularPixel = await regular
      .ensureAlpha()
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    const maskablePixel = await maskable
      .ensureAlpha()
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(regularPixel[3]).toBe(0);
    expect(maskablePixel[3]).toBe(255);
  });

  it("packs 16, 32, 48, and 256 pixel PNGs into the favicon", async () => {
    const ico = await readFile(join(publicRoot, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(4);
    const sizes = Array.from({ length: 4 }, (_, index) => {
      const value = ico.readUInt8(6 + index * 16);
      return value === 0 ? 256 : value;
    });
    expect(sizes).toEqual([16, 32, 48, 256]);
  });
});
