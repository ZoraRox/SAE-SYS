// syshub_final_summary.js
// Rekonstruksi full flow + cari URL key server dari pola string concat di VM

const fs = require("fs");
const data = JSON.parse(fs.readFileSync("syshub_v4_decoded.json", "utf8"));
const raw  = fs.readFileSync("syshub_free_raw.lua", "utf8");
const lines = raw.split("\n");
let line2 = lines.length > 1 ? lines.slice(1).join("\n") : raw;
if (line2.startsWith("\r")) line2 = line2.substring(1);

const T = new Map(data.entries.map(e => [e.i, e]));

function resolveExpr(expr) {
  if (/^-?\d+(?:[+\-]-?\d+)?$/.test(expr)) {
    try { return eval(expr); } catch(e) { return null; }
  }
  return null;
}

function getTText(tIdx) {
  const e = T.get(tIdx);
  if (!e || !e.len) return null;
  return e.text;
}

function getTHex(tIdx) {
  const e = T.get(tIdx);
  if (!e || !e.len) return null;
  return e.hex;
}

// ── Find string concatenation (.. operator) with X() calls ───────────────────
console.log("=== STRING CONCATENATION PATTERNS (.. operator) ===");

// Look for patterns like: X(..).Y  or  X(..)..X(..)  or  str..X(..)
const vmStart = line2.search(/return\s*\(\s*function\s*\(\s*T\s*,\s*Z\s*,\s*R/);
const vmSection = line2.substring(vmStart);

// Find all ".." concat operations in VM
const concatPat = /(\w+)\.\.(\w+)/g;
let cm;
const concats = [];
while ((cm = concatPat.exec(vmSection)) !== null) {
  concats.push({ pos: cm.index, expr: cm[0], a: cm[1], b: cm[2] });
}
console.log("Total '..' concat ops:", concats.length);
console.log("First 20:", concats.slice(0, 20).map(c => c.expr));

// More importantly: find assignments that lead to http calls
// Pattern: variable = T[X(...)]; then that variable is used with '..'
// OR: find the URL by looking at what T[490]="http" is concatenated with

// ── Trace T[490]="http" context more carefully ───────────────────────────────
console.log("\n=== TRACE T[490]='http' CONCAT CONTEXT ===");
// From the trace: T[490]="http" is loaded into variable l (l=T[n])
// Then B = l and 3603771+613182 or 942347+14252559
// This is: if l then B = opcode1 else B = opcode2
// So T[490] is being loaded as the executor type check ("http" executor check)
// Right after: string.sub or concat with something to make URL

// Let's look at the broader context 600 chars around T[490] usage
const t490xCallPat = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
let xm;
while ((xm = t490xCallPat.exec(line2)) !== null) {
  const v = resolveExpr(xm[1]);
  if (v !== null && Math.round(v) + 29460 === 490) {
    const start = Math.max(0, xm.index - 800);
    const end   = Math.min(line2.length, xm.index + 1200);
    const ctx   = line2.substring(start, end);

    // Annotate ALL X() calls in this window
    const annotated = ctx.replace(/X\((-?\d+(?:[+\-]-?\d+)?)\)/g, (m, expr) => {
      const v2 = resolveExpr(expr);
      if (v2 === null) return m;
      const tIdx = Math.round(v2) + 29460;
      const txt = getTText(tIdx);
      if (txt) return `X(${expr})/*"${txt}"*/`;
      return `X(${expr})/*T[${tIdx}]*/`;
    });
    console.log("\n[T[490] usage context]:");
    console.log(annotated);
    break;
  }
}

// ── Look for key/URL by tracing T[333]=":" concat pattern ────────────────────
console.log("\n=== KEY URL RECONSTRUCTION: T[333]=':', T[490]='http' near concat ===");
// From vm_trace: T[333]=":" usage at pos ~59063 in vmSection
// Context: tostring :(%d*): : pcall -> this is a port pattern ":" for string matching
// Let's look more carefully at the ".." chain near there

// Find all positions where T[490] and nearby T entries suggest URL building
// The URL is likely: "https://" .. domain .. "/check?key=" .. key
// OR assembled from multiple T parts

// Let's dump T entries that look like domain fragments
console.log("\nT entries that look like URL/domain fragments:");
const urlLikePat = /^[a-z0-9._\-/]+$/i;
const urlFragments = data.entries.filter(e =>
  e.len >= 3 && e.printRatio === 1.0 &&
  urlLikePat.test(e.text) &&
  !["UDim","Enum","print","random","Instance","Kick","delfile","Vector2","floor",
    "Color3","unpack","isfile","Create","Play","table","game","find","string",
    "tonumber","JSONDecode","remove","Destroy","setclipboard","task","math","byte",
    "pcall","error","readfile","JSONEncode","gmatch","gsub","concat","char",
    "tostring","len","syn","request","fluxus","GetService","Connect","writefile",
    "setmetatable","loadstring","http_request","Disconnect","TweenInfo","ColorSequence",
    "__index","__gc","__len","__metatable","l1","l2","http","GetClientId","SetCore",
    "FindFirstChild","ColorSequenceKeypoint","delfile","isfile","writefile","readfile",
    "UDim2"].includes(e.text)
);
for (const e of urlFragments) {
  console.log(`  T[${String(e.i).padStart(3)}] ${e.len}b: "${e.text}"`);
}

// ── Decode the binary T entries using XOR patterns ───────────────────────────
console.log("\n=== BINARY T ENTRIES - EXHAUSTIVE XOR SEARCH ===");
const binaryEntries = data.entries.filter(e => e.len >= 10 && e.printRatio < 0.5);
console.log("Binary entries to scan:", binaryEntries.length);

// For each binary entry, try ALL single-byte XOR keys and multi-byte keys
for (const e of binaryEntries) {
  const buf = Buffer.from(e.hex, "hex");
  let best = { score: 0, key: 0, text: "", keyType: "1byte" };

  // Single byte XOR
  for (let k = 0; k < 256; k++) {
    const xb = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) xb[i] = buf[i] ^ k;
    const s = xb.toString("latin1");
    let score = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) ||
          (c >= 0x30 && c <= 0x39) || c === 0x2e || c === 0x2f ||
          c === 0x3a || c === 0x5f || c === 0x2d || c === 0x3f ||
          c === 0x3d || c === 0x26 || c === 0x40 || c === 0x23) {
        score++;
      }
    }
    if (score > best.score) {
      best = { score, key: k, text: s.replace(/[^\x20-\x7e]/g, "."), keyType: "1byte" };
    }
  }

  // ROT-n (add)
  for (let k = 1; k < 256; k++) {
    const xb = Buffer.allocUnsafe(buf.length);
    for (let i = 0; i < buf.length; i++) xb[i] = (buf[i] + k) & 0xFF;
    const s = xb.toString("latin1");
    let score = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x20 && c <= 0x7e) score++;
    }
    if (score > best.score) {
      best = { score, key: k, text: s.replace(/[^\x20-\x7e]/g, "."), keyType: "add" };
    }
  }

  const ratio = (best.score / buf.length * 100).toFixed(0);
  if (best.score / buf.length > 0.6) {
    console.log(`\n  T[${e.i}] ${e.len}b - XOR/ADD 0x${best.key.toString(16).padStart(2,"0")} (${best.keyType}) score=${ratio}%:`);
    console.log(`    ${best.text}`);
  }
}

// ── Final: dump ALL entries decoded in a clean table for review ───────────────
console.log("\n=== FULL DECODED T TABLE (clean) ===");
const lines2 = [];
lines2.push("INDEX | LEN  | PRINTABLE | CONTENT");
lines2.push("------+------+-----------+----------------------------------------------------------");
for (const e of data.entries) {
  if (!e.len) {
    lines2.push(`  ${String(e.i).padStart(3)} |    0 |     -     | [EMPTY]`);
    continue;
  }
  const pr = (e.printRatio * 100).toFixed(0).padStart(3) + "%";
  const txt = e.printRatio >= 0.8
    ? `"${e.text.replace(/\n/g,"\\n").substring(0,60)}"`
    : `[hex: ${e.hex.substring(0,40)}${e.hex.length > 40 ? "..." : ""}]`;
  lines2.push(`  ${String(e.i).padStart(3)} | ${String(e.len).padStart(4)} | ${pr.padStart(7)}   | ${txt}`);
}

fs.writeFileSync("syshub_decoded_table.txt", lines2.join("\n"), "utf8");
console.log("Saved: syshub_decoded_table.txt");
