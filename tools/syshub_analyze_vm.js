// syshub_analyze_vm.js
// Analisis mendalam VM bytecode dan X() call mapping

const fs = require("fs");

const data = JSON.parse(fs.readFileSync("syshub_v4_decoded.json", "utf8"));
const raw = fs.readFileSync("syshub_free_raw.lua", "utf8");
const lines = raw.split("\n");
let line2 = lines.length > 1 ? lines.slice(1).join("\n") : raw;
if (line2.startsWith("\r")) line2 = line2.substring(1);

console.log("=== STEP 1: MAP ALL X(expr) CALLS TO T INDICES ===");
// X(X) = T[X + 29460], so tIdx = expr + 29460
const xCallPat = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
const xCalls = new Map();

let m;
while ((m = xCallPat.exec(line2)) !== null) {
  const expr = m[1];
  let val;
  try {
    // Only allow numbers, +, -, (, )
    if (/^-?\d+(?:[+\-]-?\d+)?$/.test(expr)) {
      val = eval(expr); // safe: only arithmetic
    }
  } catch (e) {}
  if (val !== undefined) {
    const tIdx = Math.round(val) + 29460;
    if (!xCalls.has(tIdx)) xCalls.set(tIdx, 0);
    xCalls.set(tIdx, xCalls.get(tIdx) + 1);
  }
}

console.log("Total unique T indices used:", xCalls.size);
const sorted = [...xCalls.entries()].sort((a, b) => a[0] - b[0]);
for (const [k, count] of sorted) {
  const e = data.entries.find((x) => x.i === k);
  if (e) {
    const txt = e.text.substring(0, 60).replace(/\n/g, "\\n");
    const pr = (e.printRatio * 100).toFixed(0).padStart(3);
    console.log(
      `  T[${String(k).padStart(3)}] (used ${count}x) ${pr}% ${e.len}b: ${txt}`
    );
  } else {
    console.log(
      `  T[${String(k).padStart(3)}] (used ${count}x) -> OUT OF RANGE!`
    );
  }
}

console.log("\n=== STEP 2: VM SECTION ANALYSIS ===");
const vmStart = line2.search(
  /return\s*\(\s*function\s*\(\s*T\s*,\s*Z\s*,\s*R/
);
const vmSection = line2.substring(vmStart);
console.log("VM section starts at:", vmStart);
console.log("VM section length:", vmSection.length);
console.log("VM section first 500 chars:", vmSection.substring(0, 500));

console.log("\n=== STEP 3: LOOK FOR INLINE STRING CONSTANTS IN VM ===");
// Find quoted strings that are NOT escape sequences (potential embedded URLs)
const strPat = /"([^"\\]{4,})"/g;
const vmStrings = [];
let sm;
while ((sm = strPat.exec(vmSection)) !== null) {
  const s = sm[1];
  if (s.length >= 4) vmStrings.push(s);
}
console.log("Non-escape strings in VM section:", vmStrings.length);
for (const s of vmStrings.slice(0, 50)) {
  console.log("  " + JSON.stringify(s));
}

console.log("\n=== STEP 4: ARITHMETIC CONSTANTS IN VM (potential opcodes) ===");
// Find large number literals in VM section (these are opcode dispatch values)
const numPat = /\b(\d{5,})\b/g;
const bigNums = new Set();
let nm;
while ((nm = numPat.exec(vmSection)) !== null) {
  bigNums.add(parseInt(nm[1]));
}
const sortedNums = [...bigNums].sort((a, b) => a - b);
console.log("Unique large numbers in VM:", sortedNums.length);
console.log("Range:", sortedNums[0], "to", sortedNums[sortedNums.length - 1]);

// These are the opcode dispatch thresholds
// Let's look at the dispatch structure more carefully
// Count if B < N patterns
const dispatchPat = /if\s*B\s*<\s*(-?\d+(?:[+\-]-?\d+)?)/g;
const dispatches = [];
let dp;
while ((dp = dispatchPat.exec(vmSection)) !== null) {
  try {
    if (/^-?\d+(?:[+\-]-?\d+)?$/.test(dp[1])) {
      dispatches.push(eval(dp[1]));
    }
  } catch (e) {}
}
dispatches.sort((a, b) => a - b);
console.log("\nVM dispatch thresholds (if B < N):", dispatches.length);
console.log("First 30:", dispatches.slice(0, 30));
console.log("Last 30:", dispatches.slice(-30));

// The VM has opcodes 0..N where N = max dispatch threshold
// Opcode count estimate:
const maxOpcode = dispatches[dispatches.length - 1];
const minOpcode = dispatches[0];
console.log("\nEstimated opcode range:", minOpcode, "to", maxOpcode);

console.log("\n=== STEP 5: FIND ALL NUMBER LITERALS USED AS T OFFSETS ===");
// Look for T[X+(number)] or T[X-(number)] patterns beyond X() wrapper
const directTPat = /T\[([^\]]+)\]/g;
const tRefs = [];
let tr;
while ((tr = directTPat.exec(line2)) !== null) {
  tRefs.push(tr[1].substring(0, 60));
}
console.log("Direct T[] references:", tRefs.length);
// Show unique patterns
const tRefUnique = [...new Set(tRefs)];
for (const r of tRefUnique.slice(0, 30)) {
  console.log("  T[" + r + "]");
}

console.log("\n=== STEP 6: LOOK FOR URL PATTERNS IN RAW SCRIPT ===");
// Sometimes URLs are embedded as arithmetic-obfuscated char codes
// and assembled via string.char()
// Look for long sequences of numbers that could be ASCII codes
const charSeqPat = /string\.char\(([^)]{20,})\)/g;
const charSeqs = [];
let cs;
while ((cs = charSeqPat.exec(line2)) !== null) {
  charSeqs.push(cs[1]);
}
console.log("string.char() sequences:", charSeqs.length);
for (const seq of charSeqs.slice(0, 10)) {
  console.log("  string.char(" + seq.substring(0, 120) + ")");
  // Try to decode
  const nums = seq.match(/-?\d+(?:[+\-]-?\d+)?/g) || [];
  let decoded = "";
  for (const n of nums.slice(0, 50)) {
    try {
      if (/^-?\d+(?:[+\-]-?\d+)?$/.test(n)) {
        const code = eval(n);
        if (code >= 32 && code <= 126) decoded += String.fromCharCode(code);
        else decoded += "?";
      }
    } catch (e) {}
  }
  if (decoded.length > 3) console.log("    -> decoded: " + decoded);
}

console.log("\n=== STEP 7: IDENTIFY KEY VALIDATION FLOW ===");
// Look for patterns near 'request' and 'GetClientId' in the VM
// by finding which T[] are referenced near those strings
const reqIdx = data.entries.find((e) => e.text === "request");
const clientIdIdx = data.entries.find((e) => e.text === "GetClientId");
const httpReqIdx = data.entries.find((e) => e.text === "http_request");
const tamperIdx = data.entries.find((e) => e.text === "Tamper Detected!");

console.log(
  "T[request]:",
  reqIdx ? reqIdx.i : "?",
  "T[GetClientId]:",
  clientIdIdx ? clientIdIdx.i : "?",
  "T[http_request]:",
  httpReqIdx ? httpReqIdx.i : "?",
  "T[Tamper Detected!]:",
  tamperIdx ? tamperIdx.i : "?"
);

// Find X() calls for these indices in the script
// and look at surrounding code (±200 chars)
function findXCallForTIdx(tIdx) {
  // X(tIdx - 29460)
  const needle = tIdx - 29460;
  // The arithmetic can be represented multiple ways, need to search for all X() calls
  // that resolve to this tIdx
  const positions = [];
  const xcp = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
  let mm;
  while ((mm = xcp.exec(line2)) !== null) {
    const expr = mm[1];
    try {
      if (/^-?\d+(?:[+\-]-?\d+)?$/.test(expr)) {
        const v = eval(expr);
        if (Math.round(v) === needle) {
          positions.push(mm.index);
        }
      }
    } catch (e) {}
  }
  return positions;
}

const interestingEntries = [
  { name: "request", e: reqIdx },
  { name: "GetClientId", e: clientIdIdx },
  { name: "http_request", e: httpReqIdx },
  { name: "Tamper Detected!", e: tamperIdx },
  {
    name: "loadstring",
    e: data.entries.find((e) => e.text === "loadstring"),
  },
  { name: "fluxus", e: data.entries.find((e) => e.text === "fluxus") },
];

for (const { name, e } of interestingEntries) {
  if (!e) continue;
  const positions = findXCallForTIdx(e.i);
  console.log(`\n  '${name}' T[${e.i}]: found at ${positions.length} position(s)`);
  for (const pos of positions.slice(0, 3)) {
    const ctx = line2.substring(Math.max(0, pos - 150), pos + 150);
    // Clean up for display: remove excessive escape codes
    const clean = ctx.replace(/\\[0-9]{3}/g, "·").replace(/\s+/g, " ");
    console.log("    [pos " + pos + "]: ..." + clean + "...");
  }
}

console.log("\n=== STEP 8: LOOK FOR NETWORK CALL PATTERNS ===");
// Find where http_request/request/syn.request are called in the VM
// by looking at what X() calls appear NEAR the request T entries
const reqPositions = findXCallForTIdx(475); // T[475] = 'request'
const httpPositions = findXCallForTIdx(18); // T[18] = 'http_request'
console.log("'request' usage positions:", reqPositions.slice(0, 5));
console.log("'http_request' usage positions:", httpPositions.slice(0, 5));

// For each position, extract ±500 chars and look for other X() calls
for (const pos of [...reqPositions, ...httpPositions].slice(0, 4)) {
  const window = line2.substring(Math.max(0, pos - 300), pos + 300);
  // Find all X() calls in this window and resolve them
  const localCalls = [];
  const lp = /X\((-?\d+(?:[+\-]-?\d+)?)\)/g;
  let lm;
  while ((lm = lp.exec(window)) !== null) {
    const expr = lm[1];
    try {
      if (/^-?\d+(?:[+\-]-?\d+)?$/.test(expr)) {
        const v = eval(expr);
        const tIdx = Math.round(v) + 29460;
        const entry = data.entries.find((e) => e.i === tIdx);
        if (entry && entry.len > 0) {
          localCalls.push(
            `T[${tIdx}]="${entry.text.substring(0, 30).replace(/\n/g, "\\n")}"`
          );
        }
      }
    } catch (e) {}
  }
  console.log(
    `\n  Near pos ${pos}: [${localCalls.slice(0, 15).join(", ")}]`
  );
}
