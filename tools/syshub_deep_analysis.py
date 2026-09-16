import re
import base64

with open(r'c:\Users\Hype\Desktop\temp\syshub_free_raw.lua', 'r', encoding='utf-8-sig') as f:
    content = f.read()

lines = content.split('\n')
line2 = lines[1] if len(lines) > 1 else content

print("=" * 70)
print("STEP 1: EXTRACT VM FUNCTION DEFINITIONS")
print("=" * 70)

# Cari awal definisi fungsi t(...) - VM utama
vm_start_patterns = [
    r'function\s+t\s*\(',
    r'local\s+function\s+t\s*\(',
    r'local\s+t\s*=\s*function',
    r't\s*=\s*function',
]

for pat in vm_start_patterns:
    matches = list(re.finditer(pat, line2))
    for m in matches:
        start = max(0, m.start() - 50)
        end_pos = min(len(line2), m.end() + 300)
        print(f"Found VM func start at pos {m.start()}:")
        print(line2[start:end_pos])
        print("---")

print("\n" + "=" * 70)
print("STEP 2: FIND X, Z, F FUNCTION DEFINITIONS")
print("=" * 70)

for func_name in ['local X', 'local Z', 'local F', 'function X', 'function Z', 'function F',
                  'X=function', 'Z=function', 'F=function',
                  'local.*X=', 'local.*Z=', 'local.*F=']:
    matches = list(re.finditer(re.escape(func_name) if '\\' not in func_name else func_name, line2))
    for m in matches[:3]:
        start = max(0, m.start() - 20)
        end_pos = min(len(line2), m.end() + 200)
        print(f"Found X/Z/F candidate at pos {m.start()} ({func_name}):")
        snippet = line2[start:end_pos]
        if len(snippet) < 500:
            print(snippet)
        else:
            print(snippet[:500])
        print("---")

print("\n" + "=" * 70)
print("STEP 3: EXTRACT STRUCTURE OF return(function(...)local T=...")
print("=" * 70)

# Lihat struktur keseluruhan - awal sampai tengah
print("FIRST 3000 chars of line2 (structured):")
chunk = line2[:3000]
# Tambahkan line break setelah ;, end, do, then untuk readability
formatted = chunk.replace(';', ';\n').replace('end', 'end\n').replace(' do ', ' do\n').replace(' then ', ' then\n')
print(formatted[:3000])

print("\n" + "=" * 70)
print("STEP 4: SEARCH FOR getfenv, _ENV, getmetatable PATTERNS")
print("=" * 70)

special_patterns = ['getfenv', '_ENV', 'getmetatable', 'setmetatable', 'unpack', 'select', 'newproxy',
                    'game:GetService', 'HttpGet', 'HttpPost', 'request', 'syn.request',
                    'TweenService', 'CoreGui', 'Players', 'Workspace', 'ReplicatedStorage']

for pat in special_patterns:
    count = line2.count(pat)
    if count > 0:
        print(f"Pattern '{pat}' found {count} times")
        # Show first occurrence context
        pos = line2.find(pat)
        start = max(0, pos - 100)
        end_pos = min(len(line2), pos + 100)
        print(f"  First occurrence: ...{line2[start:end_pos]}...")
        print()

print("\n" + "=" * 70)
print("STEP 5: DECODE ALL T ENTRIES AND LOOK FOR PRINTABLE STRINGS")
print("=" * 70)

def decode_lua_escapes(s):
    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 3 < len(s) and s[i+1:i+4].isdigit():
            code = int(s[i+1:i+4])
            result.append(chr(code))
            i += 4
        else:
            result.append(s[i])
            i += 1
    return ''.join(result)

full_T_pattern = r'local T=\{(.*?)\};'
T_match = re.search(full_T_pattern, line2, re.DOTALL)
if T_match:
    T_content = T_match.group(1)
    T_entries = re.findall(r'"((?:[^"\\]|\\.)*)"', T_content)
    print(f"Total T entries: {len(T_entries)}")
    
    printable_entries = []
    for i, entry in enumerate(T_entries):
        dec = decode_lua_escapes(entry)
        try:
            b64 = base64.b64decode(dec)
            # Coba sebagai UTF-8
            try:
                utf8_str = b64.decode('utf-8', errors='replace')
                printable_ratio = sum(1 for c in utf8_str if c.isprintable() or c in '\n\r\t') / max(1, len(utf8_str))
                if printable_ratio > 0.7 and len(utf8_str) > 3:
                    printable_entries.append((i, 'UTF8', printable_ratio, utf8_str))
            except:
                pass
            # Coba sebagai string luas biasa - cek keyword
            latin = b64.decode('latin-1', errors='replace')
            keywords = ['http', 'syshub', 'key', 'KEY', 'FREE', 'Script', 'script', 
                       'game:', 'workspace', 'print', 'error', 'warn', 'loadstring',
                       'function', 'return', 'local', 'while', 'repeat', 'if ', 'then']
            kw_hits = sum(1 for kw in keywords if kw.lower() in latin.lower())
            if kw_hits >= 2:
                printable_entries.append((i, f'KEYWORDS({kw_hits})', kw_hits, latin))
        except Exception as e:
            pass
    
    print(f"\nFound {len(printable_entries)} potentially printable entries:")
    for idx, typ, score, text in printable_entries[:50]:
        preview = text[:200] if len(text) > 200 else text
        clean_preview = ''.join(c if c.isprintable() else '.' for c in preview)
        print(f"T[{idx}] type={typ} score={score}: {clean_preview}")
