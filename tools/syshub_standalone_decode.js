const fengari = require("fengari");
const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;
const to_lua = fengari.to_luastring;
const fs = require("fs");

function toJSStr(uintArr) {
  let s = "";
  for (let i = 0; i < uintArr.length; i++) s += String.fromCharCode(uintArr[i]);
  return s;
}

const rawContent = fs.readFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_free_raw.lua",
  "utf8",
);
const lines = rawContent.split("\n");
let line2 = lines.length > 1 ? lines.slice(1).join("\n") : rawContent;
if (line2.startsWith("\r")) line2 = line2.substring(1);

// ============================================================
// EXTRACT ONLY THE DECODER PART:
// from: local T = { ...
// to  : ... end end    (end of decoder for-loop and do-block)
// Then append code to print/save T
// ============================================================

// 1. Find start of T table
const tStart = line2.indexOf("local T={");
console.log("T start at:", tStart);

// 2. Find balanced end of: "do local X=string.char ... V[T]=e(i)end end"
// The decoder block is: do local X=string.char ... V[T]=e(i)end end
// Find the 'do' before local X=string.char and then find matching 'end end'
const xStringChar = line2.indexOf("do local X=string.char");
console.log("Decoder 'do' start at:", xStringChar);

// ========== ACCURATE DECODER END DETECTION ==========
// Mark the exact position where StackVM wrapper starts: return(function(T,Z,R...
const vmReturn = line2.search(
  /return\s*\(\s*function\s*\(\s*T\s*,\s*Z\s*,\s*R/,
);
console.log("VM return(function(T,Z,R...) at line2 pos:", vmReturn);
if (vmReturn < 0) {
  console.error("Cannot find VM return(function()");
  process.exit(1);
}

// Show the 120 chars right BEFORE vmReturn so we can see the 'end end' pattern
const beforeVm = line2.substring(Math.max(0, vmReturn - 140), vmReturn);
console.log("BEFORE VM return (140 chars):", JSON.stringify(beforeVm));

// Scan backward from vmReturn to find the LAST TWO keyword 'end' that close:
//   - inner 'for T=1,#V do' decoder loop (first end)
//   - outer 'do local X=string.char' decoder block (second end -> THIS IS WHAT WE NEED)
const endPositions = [];
let searchFrom = vmReturn - 1;
while (endPositions.length < 6 && searchFrom > xStringChar) {
  const f = line2.lastIndexOf("end", searchFrom);
  if (f < 0 || f < xStringChar) break;
  // validate keyword: not inside identifier
  const beforeCh = line2[f - 1] || " ";
  const afterCh = line2[f + 3] || " ";
  if (!/\w/.test(beforeCh) && !/\w/.test(afterCh)) {
    endPositions.push({
      pos: f,
      text: "..." + line2.slice(f - 5, f + 10).replace(/\s/g, " ") + "...",
    });
  }
  searchFrom = f - 1;
}
console.log("'end' keywords just before VM return:", endPositions.slice(0, 6));

// The decoder closes with TWO consecutive 'end' keywords (end for-loop + end do-block)
// Usually the 2nd 'end' from vmReturn is what we want, but to be safe:
// Use the 'end' that is at position closest BUT >= end of for-loop decoder (which has Z(i,X(...) or V[T]=e(i) just before)
// Simpler heuristic: use the 2nd last end. But if there's 'end end' with nothing between, use that!
// Scan windowBeforeVm for "end X end" pattern
let decoderEnd = -1;
for (
  let j = 0;
  j < Math.min(endPositions.length - 1, endPositions.length);
  j++
) {
  const end1 = endPositions[j]; // later end
  const end2 = endPositions[j + 1]; // earlier end
  const between = line2.substring(end2.pos + 3, end1.pos).replace(/\s+/g, "");
  console.log(
    `  Gap between end[${j + 1}] (pos ${end2.pos}) and end[${j}] (pos ${end1.pos}): "${between}"`,
  );
  if (between === "" || between.length <= 2) {
    // Found "end end" with just whitespace between!
    decoderEnd = end1.pos + 3; // after the LATER end (closes the decoder do-block)
    console.log(
      `  => FOUND end-end pair with gap "${between}", decoderEnd = ${decoderEnd}`,
    );
    break;
  }
}
if (decoderEnd < 0) {
  // fallback: use the 2nd 'end' (index 1, because [0] is closest to vmReturn)
  decoderEnd =
    endPositions.length >= 2 ? endPositions[1].pos + 3 : vmReturn - 3;
  console.log(`  => FALLBACK: decoderEnd = ${decoderEnd}`);
}

// Extract: start from after the outer wrapper return(function(
// Actually, extract the decoder part INDEPENDENTLY so it can run standalone.
// Structure:
//   return(function(...)  <-- we need to go inside this function body
//   local T={...};
//   local function X(X)...end;
//   for X,B in ipairs(...) do...end;
//   do local X=string.char...end;
//   return(function(T,Z,R...)...  <-- STOP here
//
// But we also need to start with local variables from outer wrapper args?
// No - decoder doesn't use them. Let's extract from T declaration to decoder end.
// The first thing after return(function(...) is "local T={" - let's extract that plus everything until decoder end.
// BUT we also need to include the X function and swap loop which are between T={ and do local X=string.char

const standaloneCode = `
-- STANDALONE DECODER for SysHub Free
do
  -- Extract code from original script:
${line2.substring(tStart, decoderEnd)}
  
  -- T is now decoded. Save to GLOBAL (non-local assignment = global):
  __DECODED_T__ = T
  __DECODED_COUNT__ = #T
  
  -- Also dump info:
  print("DECODER_DONE: count=" .. tostring(#T))
  
  -- Print first few entries with printable content:
  for _i = 1, math.min(#T, 30) do
    local v = T[_i]
    if type(v) == "string" then
      local pc = 0
      for _j = 1, #v do
        local b = string.byte(v, _j)
        if (b >= 32 and b <= 126) or b == 10 or b == 13 or b == 9 then
          pc = pc + 1
        end
      end
      if #v > 0 and pc / #v > 0.5 then
        print("T[".._i.."]("..#v.."b,"..string.format("%.0f",pc/#v*100).."%): "..string.sub(string.gsub(v,"[^%g%c]","."),1,100))
      end
    end
  end
end
return __DECODED_T__
`;

console.log("\nStandalone decoder code length:", standaloneCode.length);
fs.writeFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_decoder_standalone.lua",
  standaloneCode,
  "utf8",
);
console.log("Saved standalone decoder to syshub_decoder_standalone.lua");

// ============================================================
// RUN STANDALONE DECODER IN FENGARI
// ============================================================

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

// Capture prints
const lua_prints = [];
lua.lua_pushcfunction(L, function (L2) {
  const n = lua.lua_gettop(L2);
  const parts = [];
  for (let i = 1; i <= n; i++) {
    if (lua.lua_isstring(L2, i)) {
      const sz = [0];
      const raw = lua.lua_tolstring(L2, i, sz);
      parts.push(toJSStr(raw));
    } else {
      parts.push("[" + toJSStr(lauxlib.luaL_typename(L2, i)) + "]");
    }
  }
  const line = parts.join("\t");
  lua_prints.push(line);
  process.stdout.write(`[LUA] ${line}\n`);
  return 0;
});
lua.lua_setglobal(L, to_lua("print"));

console.log("\n=== LOADING STANDALONE DECODER ===");
const loadErr = lauxlib.luaL_loadstring(L, to_lua(standaloneCode));
if (loadErr !== lua.LUA_OK) {
  const sz = [0];
  const raw = lua.lua_tolstring(L, -1, sz);
  console.error("LOAD ERROR:", toJSStr(raw));
  process.exit(1);
}

console.log("Running decoder...");
const runErr = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
if (runErr !== lua.LUA_OK) {
  const sz = [0];
  const raw = lua.lua_tolstring(L, -1, sz);
  console.log("RUN ERROR:", toJSStr(raw).substring(0, 500));
  lua.lua_pop(L, 1);
} else {
  console.log("RUN OK");
}

// ============================================================
// EXTRACT __DECODED_T__ from _G
// ============================================================

console.log("\n=== EXTRACT DECODED T ===");

// Get from global (non-local assignment __DECODED_T__ = T):
lua.lua_getglobal(L, to_lua("__DECODED_T__"));

if (!lua.lua_istable(L, -1)) {
  console.log(
    "FAILED: __DECODED_T__ global not found, trying stack return value",
  );
  // Try top of stack (if pcall returned a value)
  if (lua.lua_istable(L, -1)) {
    console.log("Found decoded T on stack top!");
  } else {
    const typnam = lauxlib.luaL_typename(L, -1);
    console.log("STILL FAILED: __DECODED_T__ type:", toJSStr(typnam));
    process.exit(1);
  }
}

lua.lua_len(L, -1);
const count = Math.floor(lua.lua_tonumber(L, -1));
lua.lua_pop(L, 1);
console.log("__DECODED_T__ entries:", count);

const allData = []; // list of {idx, len, hex, data:Buffer}
const printableList = [];

for (let i = 1; i <= count; i++) {
  lua.lua_pushinteger(L, i);
  lua.lua_gettable(L, -2);

  if (lua.lua_isstring(L, -1)) {
    const sz = [0];
    const raw = lua.lua_tolstring(L, -1, sz);
    const u8arr = new Uint8Array(raw);
    const buf = Buffer.from(u8arr.buffer, u8arr.byteOffset, u8arr.byteLength);
    allData.push({
      i,
      len: buf.length,
      hex: buf.slice(0, 30).toString("hex"),
      buf,
    });

    const txt = buf.toString("latin1");
    const printableChars = txt
      .split("")
      .filter((c) => (c >= " " && c <= "~") || "\n\r\t".includes(c)).length;
    const ratio = buf.length ? printableChars / buf.length : 0;
    if (ratio > 0.6 && buf.length > 3) {
      const preview = buf
        .toString("utf8")
        .replace(
          /[\x00-\x1f\x7f-\x9f]/g,
          (m) => "." + m.charCodeAt(0).toString(16),
        );
      printableList.push({
        i,
        len: buf.length,
        ratio: ratio.toFixed(2),
        preview: preview.substring(0, 200),
        fullHex: buf.toString("hex"),
        dataArr: Array.from(buf),
      });
    }
  } else if (lua.lua_isnil(L, -1)) {
    allData.push({ i, len: 0, hex: "", buf: Buffer.alloc(0) });
  }
  lua.lua_pop(L, 1);
}

lua.lua_pop(L, 1); // pop T table from stack

console.log("\n=== PRINTABLE ENTRIES:", printableList.length);
printableList.sort((a, b) => b.len - a.len);
for (const p of printableList.slice(0, 100)) {
  console.log(`  T[${p.i}] (${p.len}b, ${p.ratio}p): ${p.preview}`);
}
if (printableList.length > 100) {
  console.log(`  ... ${printableList.length - 100} more`);
}

// Pattern search
console.log("\n=== PATTERN SEARCH IN DECODED T ===");
const patterns = [
  "FREE-SYS-YJS2-5ERA-D525",
  "FREE-SYS",
  "FREE-",
  "SYS-",
  "YJS2",
  "5ERA",
  "D525",
  "http://",
  "https://",
  "syshub",
  ".fun",
  ".com",
  "key",
  "KEY",
  "Valid",
  "VALID",
  "valid",
  "AUTH",
  "game:GetService",
  "HttpGet",
  "HttpPost",
  "request",
  "syn.request",
  "loadstring",
  "getfenv",
  "CoreGui",
  "TweenService",
  "Players",
  "Workspace",
  "ReplicatedStorage",
  "table.insert",
  "string.char",
  "api",
  "API",
  "Auth",
  "auth",
  "getkey",
  "GetKey",
  "verify",
  "Verify",
  "discord",
  "Xeno",
  "Solara",
  "Synapse",
  "license",
  "License",
  "check",
  "Check",
  "user",
  "User",
  "pass",
  "Pass",
  "login",
  "Login",
];

// Concatenate all data
let allBuf = Buffer.alloc(0);
for (const d of allData) if (d.buf) allBuf = Buffer.concat([allBuf, d.buf]);
console.log("Total decoded bytes:", allBuf.length);
fs.writeFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_decoded_all.bin",
  allBuf,
);

for (const pat of patterns) {
  const pb = Buffer.from(pat, "latin1");
  const pos = allBuf.indexOf(pb);
  if (pos >= 0) {
    const s = Math.max(0, pos - 20);
    const e = Math.min(allBuf.length, pos + pat.length + 60);
    const ctx = allBuf
      .slice(s, e)
      .toString("latin1")
      .replace(/[\x00-\x1f\x7f-\x9f]/g, ".");
    console.log(`  GLOBAL '${pat}' @ byte ${pos}: ...${ctx}...`);
  }
  for (const p of printableList) {
    const b = Buffer.from(p.dataArr);
    const pp = b.indexOf(pb);
    if (pp >= 0) {
      const s = Math.max(0, pp - 15);
      const e = Math.min(b.length, pp + pat.length + 50);
      const ctx = b
        .slice(s, e)
        .toString("latin1")
        .replace(/[\x00-\x1f\x7f-\x9f]/g, ".");
      console.log(`  T[${p.i}] '${pat}': ...${ctx}...`);
    }
  }
}

// Save final JSON
fs.writeFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_decoded_final.json",
  JSON.stringify(
    {
      totalEntries: count,
      printableEntries: printableList.map((p) => ({
        i: p.i,
        len: p.len,
        ratio: p.ratio,
        preview: p.preview,
        hex: p.fullHex,
      })),
    },
    null,
    2,
  ),
);

console.log("\n=== SAVED FILES ===");
console.log("  syshub_decoder_standalone.lua - standalone Lua decoder script");
console.log("  syshub_decoded_all.bin - concatenated decoded T bytes");
console.log(
  "  syshub_decoded_final.json - decoded summary with printable entries & hex",
);
