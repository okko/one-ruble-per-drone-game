import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain-JS build script, deliberately untyped like scripts/content-lint.mjs.
import { encodePng } from './png.mjs';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface Chunk {
  type: string;
  data: Buffer;
  crcOk: boolean;
}

/**
 * A minimal PNG reader, used only to prove the writer.
 *
 * Decoding with the same code that encoded would prove nothing, so this walks the byte layout
 * independently: chunk lengths, chunk CRCs, and the scanline filters undone by hand.
 */
function readChunks(png: Buffer): Chunk[] {
  const out: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    const stated = png.readUInt32BE(at + 8 + length);
    out.push({ type, data, crcOk: crc32(png.subarray(at + 4, at + 8 + length)) === stated });
    at += 12 + length;
  }
  return out;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undo the per-scanline filters and return the raw pixel bytes. */
function decodePixels(png: Buffer, width: number, height: number, channels: number): Uint8Array {
  const idat = readChunks(png)
    .filter((c) => c.type === 'IDAT')
    .map((c) => c.data);
  const filtered = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const type = filtered[y * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const value = filtered[y * (stride + 1) + 1 + i] ?? 0;
      const left = i >= channels ? (out[y * stride + i - channels] ?? 0) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= channels ? (out[(y - 1) * stride + i - channels] ?? 0) : 0;
      const predictor =
        type === 0 ? 0 : type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      out[y * stride + i] = (value + predictor) & 0xff;
    }
  }
  return out;
}

function bitmap(width: number, height: number, channels: 1 | 3 | 4, fill: (i: number) => number) {
  const data = new Uint8ClampedArray(width * height * channels);
  for (let i = 0; i < data.length; i += 1) data[i] = fill(i);
  return { width, height, channels, data };
}

describe('encodePng', () => {
  it('writes the PNG signature and the three required chunks in order', () => {
    const png: Buffer = encodePng(bitmap(4, 4, 1, () => 128));
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    expect(readChunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('checksums every chunk correctly', () => {
    const png: Buffer = encodePng(bitmap(8, 8, 3, (i) => i % 251));
    for (const c of readChunks(png)) expect(c.crcOk).toBe(true);
  });

  it('records the dimensions, bit depth and colour type in IHDR', () => {
    for (const [channels, colorType] of [
      [1, 0],
      [3, 2],
      [4, 6],
    ] as const) {
      const ihdr = readChunks(encodePng(bitmap(5, 7, channels, () => 1)))[0]?.data;
      expect(ihdr?.readUInt32BE(0)).toBe(5);
      expect(ihdr?.readUInt32BE(4)).toBe(7);
      expect(ihdr?.[8]).toBe(8);
      expect(ihdr?.[9]).toBe(colorType);
      expect([ihdr?.[10], ihdr?.[11], ihdr?.[12]]).toEqual([0, 0, 0]);
    }
  });

  it('round-trips the exact pixels through an independent decoder', () => {
    for (const channels of [1, 3, 4] as const) {
      const source = bitmap(9, 6, channels, (i) => (i * 37 + 11) % 256);
      const decoded = decodePixels(encodePng(source), 9, 6, channels);
      expect([...decoded]).toEqual([...source.data]);
    }
  });

  it('round-trips a gradient, where the filter heuristic actually chooses something', () => {
    const source = bitmap(16, 16, 3, (i) => Math.floor(i / 3) % 256);
    expect([...decodePixels(encodePng(source), 16, 16, 3)]).toEqual([...source.data]);
  });

  it('is deterministic, so a rebuild produces byte-identical assets', () => {
    const make = (): Buffer => encodePng(bitmap(12, 12, 3, (i) => (i * 91) % 256));
    expect(make().equals(make())).toBe(true);
  });

  it('actually compresses a flat image rather than storing it raw', () => {
    const png: Buffer = encodePng(bitmap(64, 64, 3, () => 200));
    expect(png.length).toBeLessThan(64 * 64 * 3);
  });

  it('rejects a malformed bitmap rather than writing a corrupt texture', () => {
    expect(() => encodePng(bitmap(4, 4, 2 as 1, () => 0))).toThrow(/channel count/);
    expect(() => encodePng({ width: 0, height: 4, channels: 1, data: new Uint8ClampedArray(0) })).toThrow(
      /dimensions/,
    );
    expect(() => encodePng({ width: 4, height: 4, channels: 1, data: new Uint8ClampedArray(3) })).toThrow(
      /expected 16 bytes/,
    );
  });
});
