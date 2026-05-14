import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const output = join(process.cwd(), "public", "pass.ico");
mkdirSync(dirname(output), { recursive: true });

const sizes = [256, 128, 64, 48, 32, 16];
const images = sizes.map((size) => createPng(size));
writeFileSync(output, createIco(images));
console.log(output);

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const totalSize = headerSize + images.reduce((sum, image) => sum + image.buffer.length, 0);
  const ico = Buffer.alloc(totalSize);
  let cursor = 0;

  ico.writeUInt16LE(0, cursor);
  cursor += 2;
  ico.writeUInt16LE(1, cursor);
  cursor += 2;
  ico.writeUInt16LE(images.length, cursor);
  cursor += 2;

  let offset = headerSize;
  for (const image of images) {
    ico.writeUInt8(image.size === 256 ? 0 : image.size, cursor++);
    ico.writeUInt8(image.size === 256 ? 0 : image.size, cursor++);
    ico.writeUInt8(0, cursor++);
    ico.writeUInt8(0, cursor++);
    ico.writeUInt16LE(1, cursor);
    cursor += 2;
    ico.writeUInt16LE(32, cursor);
    cursor += 2;
    ico.writeUInt32LE(image.buffer.length, cursor);
    cursor += 4;
    ico.writeUInt32LE(offset, cursor);
    cursor += 4;
    image.buffer.copy(ico, offset);
    offset += image.buffer.length;
  }

  return ico;
}

function createPng(size) {
  const data = Buffer.alloc(size * size * 4);
  const scale = size / 256;

  fillBackground(data, size);
  drawCircle(data, size, 78 * scale, 66 * scale, 58 * scale, [255, 255, 255], 0.09);
  drawLine(data, size, 82, 135, 154, 88, 13, [255, 255, 255], 0.92);
  drawTriangle(data, size, [154, 88], [144, 113], [178, 104], [255, 255, 255], 0.92);
  drawLine(data, size, 177, 120, 102, 168, 13, [249, 115, 22], 0.96);
  drawTriangle(data, size, [102, 168], [112, 143], [78, 152], [249, 115, 22], 0.96);

  drawRoundedBorder(data, size, 42, 82, 120, 78, 14, 9, [255, 255, 255], 0.9);
  drawRoundedRect(data, size, 34, 166, 138, 14, 7, [255, 255, 255], 0.9);
  drawRoundedBorder(data, size, 169, 73, 46, 96, 14, 8, [255, 255, 255], 0.92);
  drawRoundedRect(data, size, 186, 152, 12, 5, 3, [255, 255, 255], 0.82);

  return { size, buffer: encodePng(size, size, data) };
}

function fillBackground(data, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const inside = roundedRectAlpha(x, y, size, 18, 18, 220, 220, 48);
      if (inside <= 0) continue;

      const c1 = [15, 118, 110];
      const c2 = [37, 99, 235];
      const c3 = [9, 38, 64];
      const t = clamp((nx + ny) / 1.8, 0, 1);
      const base = mixColor(mixColor(c1, c2, t), c3, Math.max(0, ny - 0.45) * 0.7);
      setPixel(data, size, x, y, base, inside);
    }
  }
}

function drawRoundedRect(data, size, x, y, w, h, r, color, alpha) {
  const s = size / 256;
  const bx = Math.floor(x * s);
  const by = Math.floor(y * s);
  const bw = Math.ceil(w * s);
  const bh = Math.ceil(h * s);
  for (let py = by; py < by + bh; py++) {
    for (let px = bx; px < bx + bw; px++) {
      const a = roundedRectAlpha(px, py, size, x, y, w, h, r);
      if (a > 0) setPixel(data, size, px, py, color, alpha * a);
    }
  }
}

function drawRoundedBorder(data, size, x, y, w, h, r, thickness, color, alpha) {
  const s = size / 256;
  const bx = Math.floor((x - 2) * s);
  const by = Math.floor((y - 2) * s);
  const bw = Math.ceil((w + 4) * s);
  const bh = Math.ceil((h + 4) * s);
  for (let py = by; py < by + bh; py++) {
    for (let px = bx; px < bx + bw; px++) {
      const outer = roundedRectAlpha(px, py, size, x, y, w, h, r);
      const inner = roundedRectAlpha(px, py, size, x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, Math.max(1, r - thickness));
      const a = clamp(outer - inner, 0, 1);
      if (a > 0) setPixel(data, size, px, py, color, alpha * a);
    }
  }
}

function drawCircle(data, size, cx, cy, radius, color, alpha) {
  const bx = Math.floor(cx - radius - 1);
  const by = Math.floor(cy - radius - 1);
  const bw = Math.ceil(radius * 2 + 2);
  for (let y = by; y < by + bw; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = clamp(radius - d, 0, 1);
      if (a > 0) setPixel(data, size, x, y, color, alpha * a);
    }
  }
}

function drawLine(data, size, x1, y1, x2, y2, width, color, alpha) {
  const s = size / 256;
  x1 *= s;
  y1 *= s;
  x2 *= s;
  y2 *= s;
  width *= s;
  const minX = Math.floor(Math.min(x1, x2) - width);
  const maxX = Math.ceil(Math.max(x1, x2) + width);
  const minY = Math.floor(Math.min(y1, y2) - width);
  const maxY = Math.ceil(Math.max(y1, y2) + width);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distanceToSegment(x, y, x1, y1, x2, y2);
      const a = clamp(width / 2 + 0.8 - d, 0, 1);
      if (a > 0) setPixel(data, size, x, y, color, alpha * a);
    }
  }
}

function drawTriangle(data, size, p1, p2, p3, color, alpha) {
  const s = size / 256;
  const pts = [p1, p2, p3].map(([x, y]) => [x * s, y * s]);
  const minX = Math.floor(Math.min(...pts.map((p) => p[0])));
  const maxX = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const minY = Math.floor(Math.min(...pts.map((p) => p[1])));
  const maxY = Math.ceil(Math.max(...pts.map((p) => p[1])));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (insideTriangle(x, y, pts[0], pts[1], pts[2])) {
        setPixel(data, size, x, y, color, alpha);
      }
    }
  }
}

function roundedRectAlpha(px, py, size, x, y, w, h, r) {
  const s = size / 256;
  x *= s;
  y *= s;
  w *= s;
  h *= s;
  r *= s;
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return clamp(0.8 - dist, 0, 1);
}

function setPixel(data, size, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
  const i = (Math.floor(y) * size + Math.floor(x)) * 4;
  const dstA = data[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  data[i] = Math.round((color[0] * alpha + data[i] * dstA * (1 - alpha)) / outA);
  data[i + 1] = Math.round((color[1] * alpha + data[i + 1] * dstA * (1 - alpha)) / outA);
  data[i + 2] = Math.round((color[2] * alpha + data[i + 2] * dstA * (1 - alpha)) / outA);
  data[i + 3] = Math.round(outA * 255);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createIhdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer.writeUInt8(8, 8);
  buffer.writeUInt8(6, 9);
  buffer.writeUInt8(0, 10);
  buffer.writeUInt8(0, 11);
  buffer.writeUInt8(0, 12);
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const buffer = Buffer.alloc(12 + data.length);
  buffer.writeUInt32BE(data.length, 0);
  typeBuffer.copy(buffer, 4);
  data.copy(buffer, 8);
  buffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mixColor(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function insideTriangle(px, py, a, b, c) {
  const area = sign(a, b, c);
  const s1 = sign([px, py], b, c);
  const s2 = sign(a, [px, py], c);
  const s3 = sign(a, b, [px, py]);
  return area < 0 ? s1 <= 0 && s2 <= 0 && s3 <= 0 : s1 >= 0 && s2 >= 0 && s3 >= 0;
}

function sign(a, b, c) {
  return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
