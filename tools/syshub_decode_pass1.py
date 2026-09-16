import re
import base64
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with open(r'c:\Users\Hype\Desktop\temp\syshub_free_raw.lua', 'r', encoding='utf-8-sig') as f:
    content = f.read()

lines = content.split('\n')
line2 = lines[1] if len(lines) > 1 else content

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

print("=" * 70)
print("STEP 1: COMPUTE ALL X() CHAR VALUES IN TABLE R")
print("=" * 70)

# Extract table R definition - this contains cipher key maps
R_match = re.search(r'local R=\{(.*?)\};', line2)
if R_match:
    R_content = R_match.group(1)
    print("Table R content (first 2000 chars):")
    print(R_content[:2000])
    
    # Compute X(a+b) values = string.char(a+b)
    R_entries = R_content.split(';')
    print(f"\nTable R has ~{len(R_entries)} entries")
    
    computed_R = {}
    for entry in R_entries:
        entry = entry.strip()
        if not entry:
            continue
        if '=' in entry:
            parts = entry.split('=', 1)
            key = parts[0].strip()
            val = parts[1].strip()
            # Compute numeric value: a+-b or a-b
            m = re.match(r'(-?\d+)(\+-?\d+)', val)
            if m:
                a = int(m.group(1))
                b_expr = m.group(2).replace('+-', '-')
                try:
                    total = a + int(b_expr)
                    char_val = chr(total) if 0 <= total <= 0x10FFFF else f'[{total}]'
                    computed_R[key] = (total, char_val)
                except:
                    pass
    
    print("\nComputed R values (showing string keys first):")
    for k, v in sorted(computed_R.items()):
        if k.startswith('"') or k.startswith("["):
            print(f"  R[{k}] = X({v[0]}) = char({v[0]}) = {repr(v[1])}")
    
    print("\nComputed R values (variable keys):")
    for k, v in sorted(computed_R.items()):
        if not (k.startswith('"') or k.startswith("[")):
            print(f"  R.{k} = X({v[0]}) = char({v[0]}) = {repr(v[1])}")

print("\n" + "=" * 70)
print("STEP 2: FIND THE T-LOOKUP X FUNCTION OFFSET")
print("=" * 70)

X_func_match = re.search(r'local\s+function\s+X\s*\(\s*X\s*\)\s*return\s+T\[X\s*\+\s*(-?\d+)\+-?(-?\d+)\]', line2)
if X_func_match:
    off1, off2 = X_func_match.groups()
    X_offset = int(off1) - int(off2)
    print(f"X-lookup function found! X(idx) = T[idx + {off1}+-{off2}] = T[idx + {X_offset}]")
    print(f"So T index = argument + ({X_offset})")
else:
    X_func_match2 = re.search(r'local\s+function\s+X\s*\(X\)return\s+T\[(.?)\]', line2)
    if X_func_match2:
        print(f"X-lookup variant: {X_func_match2.group(0)}")
    
    # Find all T[X(...] patterns
    T_index_pattern = r'T\[X\((-?\d+)\+-?(-?\d+)\)\]'
    all_T_indices = set()
    for a, b in re.findall(T_index_pattern, line2):
        idx = int(a) - int(b)
        all_T_indices.add(idx)
    sorted_idx = sorted(all_T_indices)
    print(f"\nDirect T[X()] index values: {len(sorted_idx)} unique")
    print(f"Index range: {min(sorted_idx)} to {max(sorted_idx)}")
    print(f"Sample indices: {sorted_idx[:20]}")
    # Find most common base offset
    if sorted_idx:
        # Look for common offset - if X(n) should be T[n+offset], check for lowest contiguous range
        print(f"\nContiguous check from {min(sorted_idx)}:")
        contiguous_count = 0
        expected = min(sorted_idx)
        for v in sorted_idx[:30]:
            if v == expected:
                contiguous_count += 1
                expected += 1
            else:
                break
        print(f"  First {contiguous_count} numbers are contiguous starting at {min(sorted_idx)}")
        # The offset is likely -min(sorted_idx) if contiguous starts at negative
        print(f"  Likely X_offset = {-min(sorted_idx)} (so X(0) = T[{min(sorted_idx)}])")

print("\n" + "=" * 70)
print("STEP 3: EXTRACT ALL PRINTABLE STRINGS > 5 CHARS FROM DECODED T")
print("=" * 70)

full_T_pattern = r'local T=\{(.*?)\};'
T_match = re.search(full_T_pattern, line2, re.DOTALL)
if T_match:
    T_content = T_match.group(1)
    T_entries = re.findall(r'"((?:[^"\\]|\\.)*)"', T_content)
    
    long_strings = []
    for i, entry in enumerate(T_entries):
        dec = decode_lua_escapes(entry)
        try:
            b64_bytes = base64.b64decode(dec)
            # Cari substring printable panjang
            latin = b64_bytes.decode('latin-1', errors='replace')
            # Extract all printable runs
            current_run = []
            for c in latin:
                if c.isprintable() or c in '\n\r\t':
                    current_run.append(c)
                else:
                    if len(current_run) >= 5:
                        run_str = ''.join(current_run)
                        long_strings.append((i, run_str))
                    current_run = []
            if len(current_run) >= 5:
                run_str = ''.join(current_run)
                long_strings.append((i, run_str))
        except:
            pass
    
    print(f"Found {len(long_strings)} printable string runs in T")
    unique_strings = {}
    for idx, s in long_strings:
        s_clean = s.strip()
        if len(s_clean) >= 6 and not all(c == '.' for c in s_clean):
            if s_clean not in unique_strings:
                unique_strings[s_clean] = []
            unique_strings[s_clean].append(idx)
    
    print(f"\nUnique printable strings: {len(unique_strings)}")
    for s, indices in sorted(unique_strings.items(), key=lambda x: -len(x[0])):
        print(f"T{indices} = {repr(s[:150])}")

print("\n" + "=" * 70)
print("STEP 4: SEARCH FOR HTTP-RELATED & KEY VALIDATION STRUCTURES")
print("=" * 70)

# Cari di line2 asli untuk pola yang tidak dienkripsi
http_patterns = [r'HttpGet', r'HttpPost', r'game:GetService', r'request\s*\(', r'syn\.request', 
                 r'http_request', r'httprequest', r'URL', r'url', r'SysHub', 'syshub', r'API',
                 r'getkey', r'GetKey', r'valid', r'Valid', r'VERIFY', r'verify', r'AUTH', r'auth']
for pat in http_patterns:
    positions = [m.start() for m in re.finditer(pat, line2, re.IGNORECASE)]
    if positions:
        print(f"\nPattern '{pat}' found at {len(positions)} positions")
        for pos in positions[:3]:
            start = max(0, pos - 150)
            end_pos = min(len(line2), pos + 150)
            snippet = line2[start:end_pos]
            # Clean up snippet for display
            snippet_clean = snippet.replace('\n', ' ')[:300]
            print(f"  ...{snippet_clean}...")

# Cari pola key = FREE-SYS format
key_format = re.findall(r'[A-Z0-9]{4,5}-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}', line2)
if key_format:
    print(f"\nFOUND KEY-LIKE STRINGS: {key_format}")

# Cari di decoded printable strings juga
print("\n" + "=" * 70)
print("STEP 5: CHECK ARITHMETIC OFFSET a+b COMPUTATION IN TABLE R")
print("=" * 70)

# Semua pola a+b di dalam R table
if R_match:
    all_arith = re.findall(r'(-?\d+)\+(-?\d+)', R_content)
    char_map = {}
    for a_str, b_str in all_arith[:200]:
        a = int(a_str)
        b = int(b_str)
        total = a + b
        if 0 <= total <= 255:
            c = chr(total)
            char_map[total] = c
    print(f"Found {len(char_map)} unique ASCII char codes in R arithmetic")
    sorted_chars = sorted(char_map.items())
    for code, c in sorted_chars:
        display = repr(c) if c.isprintable() else f"CTRL-{code}"
        print(f"  char({code:3d}) = {display}")
    
    # Tampilkan kalau ada yang spell kata
    ascii_chars = ''.join(c for _, c in sorted_chars if 32 <= ord(c) <= 126)
    print(f"\nAll printable chars in order: {ascii_chars}")
