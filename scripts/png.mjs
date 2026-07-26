// Minimal PNG encoder for the build-time asset generator (docs/areas/11-art-visual-style.md §3.3).
//
// This exists so the pipeline can write real image files with **no new dependency**. PNG is a short
// spec — a signature, three chunks, and CRC32 — and `node:zlib` already provides the only hard part.
// Pulling in an image library to save these fifty lines would cost more than it saved: another
// supply-chain surface, another thing to keep current, for a format that has not changed since 1998.
//
// The output is deterministic for a given input, which is what lets the generator skip work on a
// rebuild and lets a reviewer diff two builds and see nothing.
//
// Encodes greyscale (1 channel), RGB (3) and RGBA (4) at 8 bits per channel. No interlacing, no
// palettes, no ancillary chunks — none of which the generator has any use for.
import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// PNG colour types, indexed by channel count.
const COLOR_TYPE = { 1: 0, 3: 2, 4: 6 };

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// PNG filter type for each candidate, in the order they are built below. Note the gap: type 3 is
// Average, which is not generated here, so Paeth is 4 and not 3. Writing the candidate's index
// instead of its type produces a file that decodes to garbage in every reader but this one.
const FILTER_TYPES = [0, 1, 2, 4];

/**
 * Choose a filter per scanline by the standard minimum-sum-of-absolute-differences heuristic.
 *
 * It matters here: these are noise textures, and unfiltered noise barely deflates at all. Letting
 * each row pick between None, Sub, Up and Paeth typically halves the file for the smooth maps and
 * costs nothing on the ones it cannot help.
 */
function filterScanlines(data, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  const candidates = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const prior = row - stride;
    for (let i = 0; i < stride; i += 1) {
      const raw = data[row + i];
      const left = i >= channels ? data[row + i - channels] : 0;
      const up = y > 0 ? data[prior + i] : 0;
      const upLeft = y > 0 && i >= channels ? data[prior + i - channels] : 0;
      candidates[0][i] = raw;
      candidates[1][i] = (raw - left) & 0xff;
      candidates[2][i] = (raw - up) & 0xff;
      candidates[3][i] = (raw - paeth(left, up, upLeft)) & 0xff;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < candidates.length; f += 1) {
      let score = 0;
      // Signed magnitude: a byte of 250 is a delta of -6, and counting it as 250 would reject the
      // very filters that are working.
      for (let i = 0; i < stride; i += 1) {
        const v = candidates[f][i];
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const target = y * (stride + 1);
    out[target] = FILTER_TYPES[best];
    candidates[best].copy(out, target + 1);
  }
  return out;
}

/**
 * Encode a bitmap (`{ width, height, channels, data }`) as a PNG buffer.
 *
 * Throws on a malformed bitmap. That is right for a build script: a wrong-sized buffer means the
 * generator is broken, and failing the build is far better than shipping a corrupt texture.
 */
export function encodePng(bitmap) {
  const { width, height, channels, data } = bitmap;
  const colorType = COLOR_TYPE[channels];
  if (colorType === undefined) throw new Error(`encodePng: unsupported channel count ${channels}`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`encodePng: bad dimensions ${width}x${height}`);
  }
  if (data.length !== width * height * channels) {
    throw new Error(`encodePng: expected ${width * height * channels} bytes, got ${data.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  // 0/0/0: deflate, adaptive filtering, no interlace — the only combination PNG actually defines.

  const raw = filterScanlines(data, width, height, channels);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
