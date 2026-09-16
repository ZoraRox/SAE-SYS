// syshub_fengari_v4.js
// Fix: LUA_GLOBALSINDEX tidak ada di Fengari (Lua 5.3 semantics)
// Gunakan lua_getglobal() bukan lua_pushvalue(LUA_GLOBALSINDEX) + lua_getfield

const fengari = require("fengari");
const lua    = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib  = fengari.lualib;
const to_lua  = fengari.to_luastring;
const fs      = require("fs");

// ── helpers ──────────────────────────────────────────────────────────────────
function buf_to_js(raw) {
  if (raw instanceof Uint8Array) {
    let s = "";
    for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
    return s;
  }
  if (Buffer.isBuffer(raw)) return raw.toString("latin1");
  return String(raw);
}

function lua_tojs(L, idx) {
  if (lua.lua_isstring(L, idx)) {
    const sz = [0];
    return buf_to_js(lua.lua_tolstring(L, idx, sz));
  }
  if (lua.lua_isnumber(L, idx))  return String(lua.lua_tonumber(L, idx));
  if (lua.lua_isboolean(L, idx)) return String(lua.lua_toboolean(L, idx));
  if (lua.lua_isnil(L, idx))     return "nil";
  return "[" + buf_to_js(lauxlib.luaL_typename(L, idx)) + "]";
}

// ── read raw script ───────────────────────────────────────────────────────────
const rawContent = fs.readFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_free_raw.lua", "utf8");
const lines = rawContent.split("\n");
let line2 = lines.length > 1 ? lines.slice(1).join("\n") : rawContent;
if (line2.startsWith("\r")) line2 = line2.substring(1);
console.log("Script length:", line2.length, "chars");

// ── patch: inject T-save right after decoder 'end end' ───────────────────────
// Pattern: whitespace* end whitespace* end whitespace* return(function(T,Z,R
const pat = /(\s+end\s+end\s+)(return\s*\(\s*function\s*\(\s*T\s*,\s*Z\s*,\s*R)/;
const m = line2.match(pat);
let patchedScript;
if (m) {
  const injectCode = `
    do
      local _sv = {}
      for _i = 1, #T do _sv[_i] = T[_i] end
      rawset(_G, "__EXT_T__", _sv)
      rawset(_G, "__EXT_N__", #_sv)
      print("INJECT_OK:" .. tostring(#_sv))
    end
  `;
  patchedScript = line2.replace(pat, m[1] + injectCode + m[2]);
  console.log("Patch: OK");
} else {
  console.error("Patch: FAILED - pattern not found!");
  patchedScript = line2;
}

// ── create Lua state ──────────────────────────────────────────────────────────
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

// ── stub factory: every index/call returns a new stub ─────────────────────────
function makeStub(L2) {
  lua.lua_newtable(L2);
  lua.lua_newtable(L2);                  // metatable

  lua.lua_pushcfunction(L2, function(LL) {
    const k = lua.lua_isstring(LL, 2) ? lua_tojs(LL, 2) : null;
    // Some known string-returning methods
    if (k === "HttpGet" || k === "HttpPost" || k === "GetAsync" || k === "PostAsync") {
      lua.lua_pushcfunction(LL, function(L3) {
        lua.lua_pushstring(L3, to_lua(""));
        return 1;
      });
      return 1;
    }
    if (k === "JSONDecode") {
      lua.lua_pushcfunction(LL, function(L3) {
        lua.lua_newtable(L3); return 1;
      });
      return 1;
    }
    if (k === "JSONEncode") {
      lua.lua_pushcfunction(LL, function(L3) {
        lua.lua_pushstring(L3, to_lua("{}")); return 1;
      });
      return 1;
    }
    makeStub(LL);
    return 1;
  });
  lua.lua_setfield(L2, -2, to_lua("__index"));

  lua.lua_pushcfunction(L2, function(LL) {
    makeStub(LL); return 1;
  });
  lua.lua_setfield(L2, -2, to_lua("__newindex"));

  lua.lua_pushcfunction(L2, function(LL) {
    makeStub(LL); return 1;
  });
  lua.lua_setfield(L2, -2, to_lua("__call"));

  lua.lua_pushstring(L2, to_lua("__stub__"));
  lua.lua_setfield(L2, -2, to_lua("__metatable"));

  lua.lua_setmetatable(L2, -2);
}

// ── roblox globals ────────────────────────────────────────────────────────────
const robloxGlobals = ["game","workspace","script","Owner","plugin","_G_roblox"];
for (const g of robloxGlobals) {
  makeStub(L);
  lua.lua_setglobal(L, to_lua(g));
}

// Instance.new stub
makeStub(L);
lua.lua_setglobal(L, to_lua("Instance"));

// getfenv
lua.lua_pushcfunction(L, function(LL) {
  lua.lua_newtable(LL); return 1;
});
lua.lua_setglobal(L, to_lua("getfenv"));

// setfenv
lua.lua_pushcfunction(L, function(LL) { return 0; });
lua.lua_setglobal(L, to_lua("setfenv"));

// newproxy
lua.lua_pushcfunction(L, function(LL) {
  lua.lua_newuserdata(LL, 8); return 1;
});
lua.lua_setglobal(L, to_lua("newproxy"));

// request / http_request / syn.request
const httpStub = function(LL) {
  lua.lua_newtable(LL);
  lua.lua_pushstring(LL, to_lua("200"));
  lua.lua_setfield(LL, -2, to_lua("StatusCode"));
  lua.lua_pushstring(LL, to_lua(""));
  lua.lua_setfield(LL, -2, to_lua("Body"));
  return 1;
};
lua.lua_pushcfunction(L, httpStub);
lua.lua_setglobal(L, to_lua("request"));
lua.lua_pushcfunction(L, httpStub);
lua.lua_setglobal(L, to_lua("http_request"));

// setclipboard / writefile / readfile / delfile
for (const fn of ["setclipboard","writefile","readfile","delfile","appendfile","loadfile"]) {
  lua.lua_pushcfunction(L, function(LL) {
    lua.lua_pushstring(LL, to_lua("")); return 1;
  });
  lua.lua_setglobal(L, to_lua(fn));
}

// task library stub
lua.lua_newtable(L);
for (const fn of ["wait","delay","spawn","defer","synchronize","desynchronize"]) {
  lua.lua_pushcfunction(L, function(LL) { return 0; });
  lua.lua_setfield(L, -2, to_lua(fn));
}
lua.lua_setglobal(L, to_lua("task"));

// ── capture prints ────────────────────────────────────────────────────────────
const prints = [];
lua.lua_pushcfunction(L, function(LL) {
  const n = lua.lua_gettop(LL);
  const parts = [];
  for (let i = 1; i <= n; i++) parts.push(lua_tojs(LL, i));
  const line = parts.join("\t");
  prints.push(line);
  if (prints.length <= 30 || line.startsWith("INJECT")) {
    process.stdout.write("[lua] " + line + "\n");
  }
  return 0;
});
lua.lua_setglobal(L, to_lua("print"));

// warn = print
lua.lua_getglobal(L, to_lua("print"));
lua.lua_setglobal(L, to_lua("warn"));

// ── load & run ────────────────────────────────────────────────────────────────
console.log("\n=== LOADING SCRIPT ===");
const loadRet = lauxlib.luaL_loadstring(L, to_lua(patchedScript));
if (loadRet !== lua.LUA_OK) {
  console.error("LOAD ERROR:", lua_tojs(L, -1));
  process.exit(1);
}

console.log("=== RUNNING SCRIPT ===");
const runRet = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
if (runRet !== lua.LUA_OK) {
  const err = lua_tojs(L, -1);
  console.log("[runtime error - expected]:", err.substring(0, 400));
  lua.lua_pop(L, 1);
} else {
  console.log("[runtime OK]");
}

// ── extract __EXT_T__ via lua_getglobal ──────────────────────────────────────
console.log("\n=== EXTRACTING __EXT_T__ ===");
lua.lua_getglobal(L, to_lua("__EXT_T__"));
const tIdx = lua.lua_gettop(L);

if (!lua.lua_istable(L, tIdx)) {
  console.error("FAILED: __EXT_T__ is not a table, type =", lua_tojs(L, tIdx));

  // Try __EXT_N__ to see if rawset worked
  lua.lua_pop(L, 1);
  lua.lua_getglobal(L, to_lua("__EXT_N__"));
  console.log("__EXT_N__ =", lua_tojs(L, -1));
  lua.lua_pop(L, 1);

  // Fallback: check if injection print was captured
  const injPrint = prints.find(p => p.startsWith("INJECT_OK"));
  console.log("Injection print:", injPrint || "NOT FOUND");
  process.exit(1);
}

lua.lua_len(L, tIdx);
const count = Math.floor(lua.lua_tonumber(L, -1));
lua.lua_pop(L, 1);
console.log("SUCCESS: T count =", count);

// ── iterate & collect entries ─────────────────────────────────────────────────
const entries = [];      // { i, buf: Buffer }
const allBytes = [];

for (let i = 1; i <= count; i++) {
  lua.lua_pushinteger(L, i);
  lua.lua_gettable(L, tIdx);

  if (lua.lua_isstring(L, -1)) {
    const sz = [0];
    const raw = lua.lua_tolstring(L, -1, sz);
    const buf = Buffer.from(Uint8Array.from(raw));
    entries.push({ i, buf });
    for (const b of buf) allBytes.push(b);
  } else {
    entries.push({ i, buf: Buffer.alloc(0) });
  }
  lua.lua_pop(L, 1);
}

console.log("Total bytes collected:", allBytes.length);

// ── classify entries ──────────────────────────────────────────────────────────
function printableRatio(buf) {
  if (!buf.length) return 0;
  let n = 0;
  for (const b of buf) if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) n++;
  return n / buf.length;
}

function safeStr(buf) {
  return buf.toString("utf8").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g,
    c => "\\x" + c.charCodeAt(0).toString(16).padStart(2,"0"));
}

const printables = entries
  .filter(e => e.buf.length > 0 && printableRatio(e.buf) >= 0.6)
  .sort((a, b) => b.buf.length - a.buf.length);

console.log("\n=== PRINTABLE ENTRIES (" + printables.length + "/" + count + ") ===");
for (const e of printables.slice(0, 120)) {
  const pr = (printableRatio(e.buf) * 100).toFixed(0);
  const preview = safeStr(e.buf).substring(0, 200);
  console.log(`  T[${String(e.i).padStart(3)}] (${e.buf.length}b, ${pr}%): ${preview}`);
}

// ── pattern search across ALL bytes ──────────────────────────────────────────
console.log("\n=== PATTERN SEARCH ===");
const allBuf = Buffer.from(allBytes);

const PATTERNS = [
  // SysHub specifics
  "FREE-SYS", "SYS-", "syshub", "SysHub", "SYSHUB",
  // URLs
  "http://", "https://", "://", ".fun", ".xyz", ".gg", ".io", ".com",
  // key/auth
  "key", "Key", "KEY", "valid", "Valid", "VALID", "auth", "Auth", "AUTH",
  "getkey", "GetKey", "verify", "Verify", "discord", "Discord",
  "checkkey", "CheckKey", "whitelist", "Whitelist",
  // Roblox network
  "HttpGet", "HttpPost", "GetAsync", "PostAsync",
  "game:GetService", "HttpService",
  // exploit functions  
  "loadstring", "getfenv", "setfenv",
  // misc interesting
  "Tamper", "tamper", "fluxus", "Fluxus", "synapse", "krnl",
  "GetClientId", "ClientId",
  // T[n] big entries - search for readable substrings
  "lua", "Lua", "return", "local", "function",
];

const found = [];
for (const pat of PATTERNS) {
  const pb = Buffer.from(pat, "latin1");
  let pos = 0;
  while (true) {
    const idx = allBuf.indexOf(pb, pos);
    if (idx < 0) break;
    const s = Math.max(0, idx - 25);
    const e = Math.min(allBuf.length, idx + pat.length + 60);
    const ctx = allBuf.slice(s, e).toString("latin1")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, ".");
    found.push({ pat, pos: idx, ctx });
    console.log(`  [${idx}] '${pat}': ...${ctx}...`);
    pos = idx + 1;
    if (pos > allBuf.length) break;
  }
}
if (found.length === 0) console.log("  (no matches in raw byte stream)");

// Also search per-entry
console.log("\n=== PER-ENTRY PATTERN SEARCH ===");
const perEntryPats = [
  "http", "://", "syshub", "key", "valid", "auth", "discord",
  "FREE", "loadstring", "Tamper", "fluxus", "whitelist", "getkey",
];
for (const e of entries) {
  if (!e.buf.length) continue;
  const s = e.buf.toString("latin1").toLowerCase();
  for (const pat of perEntryPats) {
    if (s.includes(pat.toLowerCase())) {
      const full = safeStr(e.buf).substring(0, 300);
      console.log(`  T[${e.i}] (${e.buf.length}b) matches '${pat}': ${full}`);
      break;
    }
  }
}

// ── dump ALL entries to JSON ──────────────────────────────────────────────────
const jsonOut = {
  count,
  allBytesLen: allBytes.length,
  entries: entries.map(e => ({
    i: e.i,
    len: e.buf.length,
    printRatio: parseFloat(printableRatio(e.buf).toFixed(3)),
    hex: e.buf.toString("hex"),
    text: e.buf.length > 0 ? safeStr(e.buf).substring(0, 500) : "",
  }))
};

fs.writeFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_v4_decoded.json",
  JSON.stringify(jsonOut, null, 2),
  "utf8"
);
console.log("\nSaved: syshub_v4_decoded.json");

// ── save raw binary of all decoded bytes ─────────────────────────────────────
fs.writeFileSync(
  "c:\\Users\\Hype\\Desktop\\temp\\syshub_v4_all.bin",
  Buffer.from(allBytes)
);
console.log("Saved: syshub_v4_all.bin");

// ── dump each entry as separate file if large and binary ─────────────────────
const bigBinary = entries.filter(e => e.buf.length > 50 && printableRatio(e.buf) < 0.6);
console.log("\nBig binary entries (VM bytecode candidates):", bigBinary.length);
for (const e of bigBinary.slice(0, 20)) {
  console.log(`  T[${e.i}] ${e.buf.length}b ratio=${printableRatio(e.buf).toFixed(2)} hex[:32]=${e.buf.slice(0,32).toString("hex")}`);
}

// ── search for URL patterns in each big binary entry ─────────────────────────
console.log("\n=== DEEP SCAN: ASCII runs in binary entries ===");
for (const e of bigBinary) {
  // Find ASCII runs of >= 6 consecutive printable chars
  const runs = [];
  let run = "";
  for (let j = 0; j < e.buf.length; j++) {
    const b = e.buf[j];
    if (b >= 0x20 && b <= 0x7e) {
      run += String.fromCharCode(b);
    } else {
      if (run.length >= 6) runs.push(run);
      run = "";
    }
  }
  if (run.length >= 6) runs.push(run);
  if (runs.length > 0) {
    console.log(`  T[${e.i}] (${e.buf.length}b) ascii_runs: ${runs.slice(0,10).join(" | ")}`);
  }
}

console.log("\nDone.");
