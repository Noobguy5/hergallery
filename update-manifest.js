/* One-time generator: writes media-manifest.json from the files in this
   folder (photoN.ext / videoN.ext / coverN.jpg). Commit the result to git
   alongside index.html so the deployed site needs ZERO discovery probes.
   Re-run after adding media:  node _media_gen.js   */
const fs = require("fs"), path = require("path");

const PHOTO_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "m4v", "ogv"];

function numList(base, exts) {
  const map = new Map();
  for (const f of fs.readdirSync(".")) {
    const m = new RegExp("^" + base + "(\\d+)\\.(" + exts.join("|") + ")$", "i").exec(f);
    if (m) map.set(+m[1], f);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([n, f]) => ({ n, f }));
}

/* --- dimension sniffing (headers only) --- */
function sniffImg(b) {
  if (b[0] === 0xff && b[1] === 0xd8) {                    // JPEG
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) };
      o += 2 + b.readUInt16BE(o + 2);
    }
  }
  if (b.toString("latin1", 0, 8) === "\x89PNG\r\n\x1a\n")  // PNG
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString("latin1", 0, 6) === "GIF8")               // GIF
    return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const f = b.toString("latin1", 12, 16);
    if (f === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === "VP8L") { const x = b.readUInt32LE(21); return { w: (x & 0x3fff) + 1, h: ((x >> 14) & 0x3fff) + 1 }; }
    if (f === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  if (b.toString("latin1", 0, 2) === "BM")                 // BMP
    return { w: Math.abs(b.readInt32LE(18)), h: Math.abs(b.readInt32LE(22)) };
  return null;
}
function sniffMp4(b) {                                     // width/height from the video sample entry (avc1/hevc/etc.)
  const stsd = b.indexOf(Buffer.from("stsd"));
  if (stsd < 0) return null;
  for (const c of ["avc1", "hvc1", "hev1", "av01", "vp09", "mp4v"]) {
    let p = stsd;
    for (;;) {
      p = b.indexOf(Buffer.from(c), p + 4);
      if (p < 0) break;
      /* box_start = i-4 → width at box_start+32 */
      const w = b.readUInt16BE(p + 28), h = b.readUInt16BE(p + 30);
      if (w && h && w < 8000 && h < 8000) return { w, h };
    }
  }
  return null;
}

const photos = numList("photo", PHOTO_EXTS).map(({ n, f }) => {
  const d = sniffImg(fs.readFileSync(f));
  return { n, src: f, w: d ? d.w : 0, h: d ? d.h : 0 };
});
const videos = numList("video", VIDEO_EXTS).map(({ n, f }) => {
  let d = null;
  if (/\.mp4$/i.test(f)) d = sniffMp4(fs.readFileSync(f));
  const cov = fs.existsSync("cover" + n + ".jpg") ? "cover" + n + ".jpg" : "";
  return { n, src: f, w: d ? d.w : 0, h: d ? d.h : 0, cover: cov };
});

fs.writeFileSync("media-manifest.json", JSON.stringify({
  generated: new Date().toISOString(), photos, videos
}));
console.log("photos:", photos.length, " videos:", videos.length,
  " no-dims:", photos.filter(p => !p.w).length + videos.filter(v => !v.w).length);
