'use strict';
const zlib = require('zlib');

// Version bump for a plugin manifest and a zip of the files it names, for sharing a plugin.

const PARTS = ['major', 'minor', 'patch'];

// Bumps Version on every <Plugin> that has one. Returns {xml, from, to} for the first plugin.
function bumpVersion(xml, part) {
  const at = PARTS.indexOf(part);
  if (at === -1) throw new Error(`Bump major, minor or patch (got "${part}").`);
  let first = null;
  const out = xml.replace(/(<Plugin\b[^>]*?\bVersion=")([^"]*)(")/g, (all, pre, ver, post) => {
    const nums = ver.split('.').map(Number);
    if (nums.length < 2 || nums.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`Cannot bump version "${ver}"; use numbers like 0.1.0.`);
    while (nums.length < 3) nums.push(0);
    nums[at] += 1;
    for (let i = at + 1; i < 3; i++) nums[i] = 0;
    const next = nums.join('.');
    if (!first) first = { from: ver, to: next };
    return pre + next + post;
  });
  if (!first) throw new Error('No <Plugin Version="..."> found to bump.');
  return { xml: out, ...first };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{name, data: Buffer}] -> zip file as a Buffer (deflate, UTF-8 names, fixed timestamp).
function zip(files) {
  const DOS_TIME = 0;
  const DOS_DATE = (46 << 9) | (1 << 5) | 1; // 2026-01-01; fixed so identical input gives identical output
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.data);
    const data = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

module.exports = { bumpVersion, zip, crc32 };
