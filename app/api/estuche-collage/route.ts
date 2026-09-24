// GET /api/estuche-collage
// Creates a 2×2 collage from up to 4 Nihao CDN image URLs.
// Usage: /api/estuche-collage?urls=URL1,URL2,URL3,URL4
// Falls back to the estándar case image if fewer URLs provided.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const FALLBACK_IMG =
  "https://img.nihaojewelry.com/product/2025/9/18/1968598333173927936.png";

const NIHAO_REFERER = "https://www.nihaojewelry.com/";

const TILE = 240; // px per tile → final image is 480×480

async function fetchNihao(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Referer: NIHAO_REFERER },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function tile(url: string, gravity?: string): Promise<Buffer> {
  const raw = await fetchNihao(url);
  return sharp(raw)
    .resize(TILE, TILE, { fit: "cover", position: (gravity ?? "centre") as "north" | "centre" | "south" | "entropy" })
    .png()
    .toBuffer();
}

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("urls") ?? "";
  const rawUrls = param
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  // Pad to 4 using the fallback (with different gravity crops for variety)
  const gravities = ["north", "centre", "south", "entropy"] as const;
  const urls: [string, string][] = [0, 1, 2, 3].map((i) => [
    rawUrls[i] ?? FALLBACK_IMG,
    gravities[i],
  ]);

  try {
    const tiles = await Promise.all(urls.map(([u, g]) => tile(u, g)));

    const collage = await sharp({
      create: {
        width: TILE * 2,
        height: TILE * 2,
        channels: 3,
        background: { r: 248, g: 248, b: 248 },
      },
    })
      .composite([
        { input: tiles[0], left: 0,    top: 0    },
        { input: tiles[1], left: TILE, top: 0    },
        { input: tiles[2], left: 0,    top: TILE },
        { input: tiles[3], left: TILE, top: TILE },
      ])
      .jpeg({ quality: 85 })
      .toBuffer();

    return new NextResponse(collage, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error("estuche-collage error:", err);
    return NextResponse.json({ error: "collage failed" }, { status: 500 });
  }
}
