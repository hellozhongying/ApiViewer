import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 48, 128];
const supersampling = 4;
const eyeOutline = [];

for (let step = 0; step <= 64; step += 1) {
  const x = 27 + (74 * step) / 64;
  const normalizedX = (x - 64) / 37;
  eyeOutline.push([x, 64 - 26 * (1 - normalizedX * normalizedX)]);
}
for (let step = 64; step >= 0; step -= 1) {
  const x = 27 + (74 * step) / 64;
  const normalizedX = (x - 64) / 37;
  eyeOutline.push([x, 64 + 26 * (1 - normalizedX * normalizedX)]);
}

for (const size of sizes) {
  const high = size * supersampling;
  const rgba = new Uint8Array(high * high * 4);
  const unit = high / 128;

  for (let y = 0; y < high; y += 1) {
    for (let x = 0; x < high; x += 1) {
      const px = (x + .5) / unit;
      const py = (y + .5) / unit;
      const index = (y * high + x) * 4;
      if (insideRoundedRect(px, py, 8, 8, 112, 112, 28)) {
        const t = Math.max(0, Math.min(1, ((px - 18) + (py - 10)) / 206));
        rgba[index] = mix(75, 31, t);
        rgba[index + 1] = mix(145, 78, t);
        rgba[index + 2] = mix(255, 216, t);
        rgba[index + 3] = 255;
      }

      const onEyeOutline = polyline(px, py, eyeOutline, 8);
      const onIris = Math.hypot(px - 64, py - 64) <= 15;
      const onPupil = Math.hypot(px - 64, py - 64) <= 6;
      if (onEyeOutline || onIris) {
        rgba[index] = 255;
        rgba[index + 1] = 255;
        rgba[index + 2] = 255;
        rgba[index + 3] = 255;
      }
      if (onPupil) {
        rgba[index] = 43;
        rgba[index + 1] = 100;
        rgba[index + 2] = 229;
        rgba[index + 3] = 255;
      }
    }
  }

  const downsampled = downsample(rgba, high, size, supersampling);
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), encodePng(size, size, downsampled));
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + radius, Math.min(right - radius, x));
  const cy = Math.max(top + radius, Math.min(bottom - radius, y));
  return Math.hypot(x - cx, y - cy) <= radius;
}

function segment(x, y, x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= width / 2;
}

function polyline(x, y, points, width) {
  for (let index = 1; index < points.length; index += 1) {
    if (segment(x, y, ...points[index - 1], ...points[index], width)) return true;
  }
  return segment(x, y, ...points.at(-1), ...points[0], width);
}

function mix(from, to, amount) {
  return Math.round(from + (to - from) * amount);
}

function downsample(source, sourceSize, targetSize, scale) {
  const result = new Uint8Array(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const sourceIndex = (((y * scale + sy) * sourceSize) + x * scale + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[sourceIndex + channel];
        }
      }
      const targetIndex = (y * targetSize + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) result[targetIndex + channel] = Math.round(totals[channel] / (scale * scale));
    }
  }
  return result;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (width * 4 + 1);
    scanlines[offset] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(scanlines, offset + 1);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
