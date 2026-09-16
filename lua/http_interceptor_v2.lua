-- ============================================================
-- SysHub V2 HTTP Interceptor
-- Jalankan SEBELUM syshub_v2_loader.lua
-- ============================================================

local saved = {}
local count = 0

local function wrapHTTP(fn)
    if not fn then return nil end
    return function(opts)
        local res = fn(opts)
        if res and res.Body and #res.Body > 500 then
            count = count + 1
            local url = ""
            if type(opts) == "table" then
                url = tostring(opts.Url or opts.url or "unknown")
            elseif type(opts) == "string" then
                url = opts
            end

            saved[count] = { url = url, body = res.Body }

            print("[V2 INTERCEPT #"..count.."] URL: "..url)
            print("[V2 INTERCEPT #"..count.."] Body len: "..#res.Body)

            local fname = "syshub_v2_intercept_"..count..".lua"
            local ok = pcall(writefile, fname, res.Body)
            if ok then
                print("[V2 INTERCEPT #"..count.."] Saved: "..fname)
            end

            if res.Body:find("function") or res.Body:find("local ") or res.Body:find("return") then
                print("[V2 INTERCEPT #"..count.."] >>> KEMUNGKINAN PAYLOAD LUA! <<<")
            end
        end
        return res
    end
end

if http_request then
    http_request = wrapHTTP(http_request)
    print("[V2 INTERCEPT] Hooked: http_request")
end
if request then
    request = wrapHTTP(request)
    print("[V2 INTERCEPT] Hooked: request")
end
if syn and syn.request then
    syn.request = wrapHTTP(syn.request)
    print("[V2 INTERCEPT] Hooked: syn.request")
end
if http and http.request then
    http.request = wrapHTTP(http.request)
    print("[V2 INTERCEPT] Hooked: http.request")
end

_G.v2GetBody = function(n) return saved[n] and saved[n].body end
_G.v2ShowAll = function()
    for i, v in ipairs(saved) do
        print("--- #"..i.." ---")
        print("URL: "..v.url)
        print("Len: "..#v.body)
    end
end

print("[V2 INTERCEPT] Semua hooks aktif. Sekarang jalankan syshub_v2_loader.lua")
