// syshub_trace_vm.js
// Deep trace: resolve ALL X(expr) calls in ±800 chars around critical positions

const fs = require("fs");
const data = JSON.parse(fs.readFileSync("syshub_v4_decoded.json", "utf8"));
const raw  = fs.readFileSync("syshub_free_raw.lua", "utf8");
const lines = raw.split("\n");
let line2 = lines.length > 1 ? lines.slice(1).join("\n") : raw;
if (line2.startsWith("\r")) line2 = line2.substring(1);

// T lookup
const T = new Map(data.entries.map(e => [e.i, e]));

function resolveExpr(expr) {
  if (/^-?\d+(?:[+\-]-?\d+)?$/.test(expr)) {
    try { return eval(expr); } catch(e) { return null; }
  }
  return null;
}

function getTText(tIdx) {
  const e = T.get(tIdx);
  if (!e) return `[OUT_OF_RANGE:${tIdx}]`;
  if (!e.len) return `[EMPTY]`;
  if (e.printRatio >= 0.85) return `"${e.text.replace(/\n/g,"\\n")}"`;
  return `[${e.len}b,${(e.printRatio*100).toFixed(0)}%:${e.text.substring(0,20).replace(/\n/g,"\\n")}]`;
}

// Replace all X(expr) with resolved values in a string window
function annotate(code) {
  return code.replace(/X\((-?\d+(?:[+\-]-?\d+)?)\)/g, (m, expr) => {
    const v = resolveExpr(expr);
    if (v === null) return m;
    const tIdx = Math.round(v) + 29460;
    return `X(${expr})/*T[${tIdx}]=${getTText(tIdx)}*/`;
  }).replace(/-?\d+\+-?\d+|-?\d+-\(-\d+\)/g, (m) => {
    const v = resolveExpr(m);
    return v !== null ? `${m}/*=${v}*/` : m;
  });
}

// Critical positions from previous analysis
const criticalPositions = [
  { name: "GetClientId (1)", pos: 34950 },
  { name: "GetClientId (2)", pos: 93514 },
  { name: "http_request",   pos: 93905 },
  { name: "Tamper Detected!", pos: 94757 },
  { name: "loadstring",     pos: 60151 },
  { name: "fluxus (1)",     pos: 44751 },
  { name: "fluxus (2)",     pos: 94150 },
];

const output = [];

for (const { name, pos } of criticalPositions) {
  const start = Math.max(0, pos - 600);
  const end   = Math.min(line2.length, pos + 600);
  const window = line2.substring(start, end);
  const annotated = annotate(window);
  
  output.push(`\n${"=".repeat(80)}`);
  output.push(`=== ${name} @ pos ${pos} ===`);
  output.push(`${"=".repeat(80)}`);
  output.push(annotated);
}

// Also: look specifically for the http call construction
// Near http_request at pos 93905: find what comes AFTER it (URL construction)
output.push(`\n${"=".repeat(80)}`);
output.push("=== BROADER HTTP_REQUEST CONTEXT (pos 92000-95500) ===");
output.push(`${"=".repeat(80)}`);
const httpCtx = line2.substring(92000, 95500);
output.push(annotate(httpCtx));

// Look at ALL T entries that have small size (1-5 chars) - these might be URL fragments
output.push(`\n${"=".repeat(80)}`);
output.push("=== SMALL T ENTRIES (potential URL/key fragments) ===");
output.push(`${"=".repeat(80)}`);
const smallPrintable = data.entries.filter(e =>
  e.len > 0 && e.len <= 8 && e.printRatio >= 0.75
);
for (const e of smallPrintable) {
  output.push(`T[${String(e.i).padStart(3)}] ${e.len}b: ${JSON.stringify(e.text)}`);
}

// Attempt to find all T entries that look like URL parts
output.push(`\n${"=".repeat(80)}`);
output.push("=== T ENTRIES THAT COULD BE URL/DOMAIN PARTS ===");
output.push(`${"=".repeat(80)}`);
const urlChars = /^[a-zA-Z0-9._/:?=&\-]+$/;
for (const e of data.entries) {
  if (e.len > 2 && e.printRatio === 1 && urlChars.test(e.text)) {
    output.push(`T[${String(e.i).padStart(3)}] ${e.len}b: ${JSON.stringify(e.text)}`);
  }
}

// Try to find URL by XOR-decoding the T[490]="http" context
// T[490] = "http" (4 bytes) used once - where?
// Find the X() call for T[490]
const t490calls = [];
const xp = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
let xm;
while ((xm = xp.exec(line2)) !== null) {
  const v = resolveExpr(xm[1]);
  if (v !== null && Math.round(v) + 29460 === 490) {
    t490calls.push(xm.index);
  }
}
output.push(`\n${"=".repeat(80)}`);
output.push(`=== T[490]="http" USAGE (${t490calls.length} positions) ===`);
output.push(`${"=".repeat(80)}`);
for (const pos of t490calls) {
  const ctx = line2.substring(Math.max(0,pos-400), pos+400);
  output.push(annotate(ctx));
}

// T[333]=":" - could be part of URL like "http" + ":" + "//"
const t333calls = [];
const xp2 = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
let xm2;
while ((xm2 = xp2.exec(line2)) !== null) {
  const v = resolveExpr(xm2[1]);
  if (v !== null && Math.round(v) + 29460 === 333) {
    t333calls.push(xm2.index);
  }
}
output.push(`\n${"=".repeat(80)}`);
output.push(`=== T[333]=":" USAGE (${t333calls.length} positions) ===`);
output.push(`${"=".repeat(80)}`);
for (const pos of t333calls.slice(0, 3)) {
  const ctx = line2.substring(Math.max(0,pos-300), pos+300);
  output.push(annotate(ctx));
}

// Look for consecutive T lookups that together spell URL fragments
// Scan the vmSection for sequences of X() calls within 100 chars of each other
output.push(`\n${"=".repeat(80)}`);
output.push("=== CONSECUTIVE T LOOKUPS (possible string concatenation) ===");
output.push(`${"=".repeat(80)}`);

const vmStart = line2.search(/return\s*\(\s*function\s*\(\s*T\s*,\s*Z\s*,\s*R/);
const vmSection = line2.substring(vmStart);

// Find all X() call positions and resolved T values in VM section
const allXCalls = [];
const xp3 = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
let xm3;
while ((xm3 = xp3.exec(vmSection)) !== null) {
  const v = resolveExpr(xm3[1]);
  if (v !== null) {
    const tIdx = Math.round(v) + 29460;
    const entry = T.get(tIdx);
    allXCalls.push({
      pos: xm3.index,
      tIdx,
      text: entry ? entry.text : "",
      printRatio: entry ? entry.printRatio : 0,
      len: entry ? entry.len : 0,
    });
  }
}

// Find clusters: groups of X() calls where adjacent calls are within 120 chars
// and the resolved strings are printable
const clusters = [];
let currentCluster = [];
for (let i = 0; i < allXCalls.length; i++) {
  const cur = allXCalls[i];
  if (currentCluster.length === 0) {
    if (cur.printRatio >= 0.8 && cur.len > 0) currentCluster.push(cur);
  } else {
    const last = currentCluster[currentCluster.length - 1];
    if (cur.pos - last.pos < 200 && cur.printRatio >= 0.8 && cur.len > 0) {
      currentCluster.push(cur);
    } else {
      if (currentCluster.length >= 3) clusters.push([...currentCluster]);
      currentCluster = cur.printRatio >= 0.8 && cur.len > 0 ? [cur] : [];
    }
  }
}
if (currentCluster.length >= 3) clusters.push(currentCluster);

output.push(`Found ${clusters.length} clusters of consecutive printable T lookups:`);
for (const cluster of clusters.slice(0, 30)) {
  const combined = cluster.map(c => c.text).join(" ");
  const positions = cluster.map(c => `T[${c.tIdx}]="${c.text}"`).join(", ");
  output.push(`  Cluster @pos${cluster[0].pos}: [${positions}] => "${combined}"`);
}

fs.writeFileSync("syshub_vm_trace.txt", output.join("\n"), "utf8");
console.log("Saved: syshub_vm_trace.txt (" + output.length + " lines)");

// Also print summary to console
console.log("\n=== KEY FINDINGS SUMMARY ===");

// Print the http_request area annotated
console.log("\n--- http_request area ---");
const httpArea = line2.substring(93400, 94200);
const httpAnnotated = annotate(httpArea);
// Show a compact version
console.log(httpAnnotated.substring(0, 3000));
