-- ============================================================
-- SysHub HTTP Interceptor
-- Cara pakai:
-- 1. Jalankan script ini DULU sebelum SysHub
-- 2. Lalu jalankan SysHub dengan key valid
-- 3. Semua response HTTP akan tersimpan di game folder
--    atau di-print ke console
-- ============================================================

local saved = {}
local count = 0

-- ── wrap semua fungsi HTTP yang mungkin ada ──────────────────

local function wrapHTTP(fn, name)
    if not fn then return nil end
    return function(opts)
        local res = fn(opts)
        if res and res.Body and #res.Body > 50 then
            count = count + 1
            local url = ""
            if type(opts) == "table" then
                url = tostring(opts.Url or opts.url or "unknown")
            elseif type(opts) == "string" then
                url = opts
            end

            -- simpan ke tabel
            saved[count] = {
                url  = url,
                body = res.Body,
                len  = #res.Body
            }

            print("[INTERCEPT #"..count.."] URL: "..url)
            print("[INTERCEPT #"..count.."] Body len: "..#res.Body)

            -- coba simpan ke file
            local fname = "syshub_intercept_"..count..".lua"
            local ok = pcall(writefile, fname, res.Body)
            if ok then
                print("[INTERCEPT #"..count.."] Saved to: "..fname)
            else
                -- kalau writefile gagal, print 500 char pertama
                print("[INTERCEPT #"..count.."] Body preview:")
                print(res.Body:sub(1, 500))
            end

            -- kalau isinya Lua code (ada 'function' atau 'local' atau 'return')
            if res.Body:find("function") or res.Body:find("local ") or res.Body:find("return") then
                print("[INTERCEPT #"..count.."] >>> KEMUNGKINAN INI PAYLOAD LUA! <<<")
            end
        end
        return res
    end
end

-- hook semua method yang mungkin dipakai SysHub
if syn and syn.request then
    syn.request = wrapHTTP(syn.request, "syn.request")
    print("[INTERCEPT] Hooked: syn.request")
end

if http_request then
    local _orig = http_request
    http_request = wrapHTTP(_orig, "http_request")
    print("[INTERCEPT] Hooked: http_request")
end

if request then
    local _orig = request
    request = wrapHTTP(_orig, "request")
    print("[INTERCEPT] Hooked: request")
end

if http and http.request then
    http.request = wrapHTTP(http.request, "http.request")
    print("[INTERCEPT] Hooked: http.request")
end

-- HttpGet juga
local _origHttpGet = nil
if game and game.HttpGet then
    _origHttpGet = game.HttpGet
end

print("[INTERCEPT] Semua HTTP hooks aktif.")
print("[INTERCEPT] Sekarang jalankan SysHub dengan key valid.")
print("[INTERCEPT] File payload akan tersimpan sebagai syshub_intercept_X.lua")

-- ── helper: lihat semua yang sudah ter-intercept ─────────────
_G.showIntercepted = function()
    if #saved == 0 then
        print("[INTERCEPT] Belum ada response yang ter-capture.")
        return
    end
    for i, v in ipairs(saved) do
        print("--- #"..i.." ---")
        print("URL : "..v.url)
        print("Len : "..v.len)
        print("Body: "..v.body:sub(1, 200))
    end
end

-- ── helper: get body ke-N ────────────────────────────────────
_G.getBody = function(n)
    if saved[n] then
        return saved[n].body
    end
    return nil
end

print("[INTERCEPT] Tips: jalankan showIntercepted() untuk lihat semua hasil.")
print("[INTERCEPT] Tips: jalankan getBody(1) untuk ambil body pertama.")
