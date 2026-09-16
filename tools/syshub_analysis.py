import re
import base64
import sys

with open(r'c:\Users\Hype\Desktop\temp\syshub_free_raw.lua', 'r', encoding='utf-8-sig') as f:
    content = f.read()

lines = content.split('\n')
line2 = lines[1] if len(lines) > 1 else content

print("=" * 70)
print("STEP 1: EXTRACT ESCAPE STRINGS FROM TABLE T")
print("=" * 70)

escape_pattern = r'"((?:\\\d{3})+)"'
escaped_strings = re.findall(escape_pattern, line2)
print(f"Found {len(escaped_strings)} escaped strings in table T")

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

decoded_table = []
for idx, esc in enumerate(escaped_strings):
    decoded = decode_lua_escapes(esc)
    try:
        b64_decoded = base64.b64decode(decoded).decode('latin-1', errors='replace')
        decoded_table.append((idx, decoded, b64_decoded))
    except Exception as e:
        decoded_table.append((idx, decoded, f"[B64 ERROR: {e}]"))

print("\n" + "=" * 70)
print("STEP 2: FIRST 50 ENTRIES OF DECODED TABLE T")
print("=" * 70)
for i, (idx, raw, b64) in enumerate(decoded_table[:50]):
    print(f"T[{idx:3d}] | raw({len(raw):3d}ch) = {repr(raw[:60])}")
    if b64.startswith('[B64'):
        print(f"         | b64 = {b64}")
    else:
        print(f"         | b64({len(b64):3d}ch) = {repr(b64[:80])}")

print("\n" + "=" * 70)
print("STEP 3: SEARCH FOR KEY PATTERNS & URLS IN ALL DECODED ENTRIES")
print("=" * 70)

key_patterns = ['FREE', 'SYS', 'YJS2', '5ERA', 'D525', 'KEY', 'key', 'License', 'license', 'VALID']
url_patterns = ['http://', 'https://', '.fun', '.com', '.xyz', '.gg', 'syshub', 'api']

interesting = []
for idx, raw, b64 in decoded_table:
    all_text = raw + b64
    hits = []
    for pat in key_patterns:
        if pat in all_text:
            hits.append(f'KEY:{pat}')
    for pat in url_patterns:
        if pat.lower() in all_text.lower():
            hits.append(f'URL:{pat}')
    if b64 and not b64.startswith('[B64') and (len(b64) > 15 or hits):
        if hits or (len(b64) > 30 and any(c.isalpha() for c in b64) and ' ' not in b64[:50]):
            interesting.append((idx, raw, b64, hits))

print(f"Found {len(interesting)} interesting entries")
for idx, raw, b64, hits in interesting:
    print(f"\n--- T[{idx}] hits={hits} ---")
    print(f"  RAW: {repr(raw[:100])}")
    if len(b64) < 500:
        print(f"  B64 FULL: {repr(b64)}")
    else:
        print(f"  B64 FIRST 500: {repr(b64[:500])}")
        print(f"  B64 LAST 200:  {repr(b64[-200:])}")

print("\n" + "=" * 70)
print("STEP 4: SEARCH FOR ARITHMETIC INDEX PATTERNS")
print("=" * 70)

arith_pattern = r'X\((-?\d+)\+-?(-?\d+)\)'
arith_matches = re.findall(arith_pattern, line2)
unique_indices = set()
for a, b in arith_matches:
    try:
        result = int(a) - int(b)
        unique_indices.add(result)
    except:
        pass

sorted_indices = sorted(unique_indices)
print(f"Found {len(sorted_indices)} unique X() computed indices")
print(f"Index range: {min(sorted_indices)} to {max(sorted_indices)}")
print(f"First 100 indices: {sorted_indices[:100]}")

print("\n" + "=" * 70)
print("STEP 5: EXTRACT FULL TABLE T STRUCTURE (FIRST 200 ENTRIES)")
print("=" * 70)

full_T_pattern = r'local T=\{(.*?)\};'
T_match = re.search(full_T_pattern, line2, re.DOTALL)
if T_match:
    T_content = T_match.group(1)
    T_entries = re.findall(r'"((?:[^"\\]|\\.)*)"', T_content)
    print(f"Total T entries extracted: {len(T_entries)}")
    for i, entry in enumerate(T_entries[:200]):
        dec = decode_lua_escapes(entry)
        try:
            b64 = base64.b64decode(dec).decode('latin-1', errors='replace')
        except:
            b64 = "[B64 FAIL]"
        if len(b64) > 1 and b64 != "[B64 FAIL]":
            preview = repr(b64[:60]) if len(b64) < 60 else repr(b64[:60]) + "..."
            print(f"T[{i}] = {preview}")

print("\nDone!")
