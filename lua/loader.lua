-- SysHub Bypass Loader
-- Langsung load payload dari syshub_intercept_2.lua (hasil intercept)
-- tanpa perlu key apapun
--
-- Cara pakai:
-- loadstring(game:HttpGet("https://raw.githubusercontent.com/Galangpratama-rox/Decode-Sys/main/lua/loader.lua"))()

-- ── HTTP helper ──────────────────────────────────────────────
local function httpGet(u)
    if syn and syn.request then
        local r = pcall(function() return syn.request({Url=u,Method="GET"}) end)
        if r and r.Body and #r.Body > 0 then return r.Body end
    end
    if http_request then
        local ok,r = pcall(http_request,{Url=u,Method="GET"})
        if ok and r and r.Body and #r.Body > 0 then return r.Body end
    end
    if request then
        local ok,r = pcall(request,{Url=u,Method="GET"})
        if ok and r and r.Body and #r.Body > 0 then return r.Body end
    end
    if http and http.request then
        local ok,r = pcall(http.request,{Url=u,Method="GET"})
        if ok and r and r.Body and #r.Body > 0 then return r.Body end
    end
    local ok,r = pcall(function() return game:HttpGet(u,true) end)
    if ok and r and #r > 0 then return r end
    return nil
end

-- ── coba load dari file intercept lokal dulu ─────────────────
local payload = nil

if isfile and isfile("syshub_intercept_2.lua") then
    print("[Loader] Membaca payload dari file lokal...")
    local raw = readfile("syshub_intercept_2.lua")
    -- response berupa JSON: {"status":"success","script":"..."}
    local script = raw:match('"script"%s*:%s*"(.-[^\\])"')
    if not script then
        -- coba kalau langsung Lua (bukan JSON)
        if raw:find("^%s*%-%-") or raw:find("^%s*local ") or raw:find("^%s*return ") then
            script = raw
        end
    end
    if script then
        -- unescape JSON string escapes
        script = script:gsub('\\"', '"')
        script = script:gsub('\\r\\n', '\n')
        script = script:gsub('\\n', '\n')
        script = script:gsub('\\t', '\t')
        script = script:gsub('\\\\', '\\')
        payload = script
        print("[Loader] Payload dari file: " .. #payload .. " chars")
    end
end

-- ── fallback: load ulang dari github raw ─────────────────────
if not payload then
    print("[Loader] File lokal tidak ditemukan, load dari GitHub...")
    local raw = httpGet("https://raw.githubusercontent.com/Galangpratama-rox/Decode-Sys/main/lua/syshub_free_raw.lua")
    if raw then
        -- strip komentar baris pertama
        raw = raw:gsub("^[^\n]*\n", "", 1)
        payload = raw
        print("[Loader] Payload dari GitHub: " .. #payload .. " chars")
    end
end

if not payload then
    error("[Loader] Gagal mendapatkan payload dari semua sumber!")
end

-- ── eksekusi payload ──────────────────────────────────────────
local fn, err = loadstring(payload)
if not fn then
    error("[Loader] loadstring error: " .. tostring(err))
end

print("[Loader] Executing payload...")
local env = getfenv and getfenv() or _ENV
local ok, runerr = pcall(fn, env)
if not ok then
    error("[Loader] Runtime error: " .. tostring(runerr))
end
