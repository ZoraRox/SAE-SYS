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

# EXTRACT FULL R table from line2
# Find balanced braces starting at local R={
R_start = line2.find('local R={')
print(f"R_start = {R_start}")

# Parse balanced { }
depth = 0
i = R_start
start_brace = -1
while i < len(line2):
    c = line2[i]
    if c == '{':
        depth += 1
        if start_brace < 0:
            start_brace = i
    elif c == '}':
        depth -= 1
        if depth == 0 and start_brace >= 0:
            R_end = i + 1
            break
    i += 1

R_full_text = line2[R_start:R_end]
print(f"Full R text length = {len(R_full_text)}")
print(f"R_full_text first 500 chars: {R_full_text[:500]}")
print(f"R_full_text last 500 chars: {R_full_text[-500:]}")

# Now properly extract all key=value pairs
def compute_arith(expr):
    expr = expr.strip()
    # Handle a+-b format
    m = re.match(r'^(-?\d+)(\+-?\d+)$', expr)
    if m:
        a = int(m.group(1))
        b_str = m.group(2).replace('+-', '-')
        return a + int(b_str)
    return None

R_map = {}  # char -> 6-bit digit value
R_inner = R_full_text[R_full_text.find('{')+1 : R_full_text.rfind('}')]
print(f"\nR_inner length = {len(R_inner)}")

# Split by comma and semicolon (Lua allows both separators)
tokens = re.split(r'[;,]', R_inner)
print(f"Tokens after split: {len(tokens)}")

for tok in tokens:
    tok = tok.strip()
    if not tok:
        continue
    if '=' not in tok:
        print(f"  SKIP no-equals token: {repr(tok[:60])}")
        continue
    key_part, val_part = tok.split('=', 1)
    key_part = key_part.strip()
    val_part = val_part.strip()
    
    # Parse key part
    if key_part.startswith('["') and key_part.endswith('"]'):
        inner = key_part[2:-2]
        char_key = decode_lua_escapes(inner)
    elif key_part.startswith('[\'') and key_part.endswith('\']'):
        inner = key_part[2:-2]
        char_key = decode_lua_escapes(inner)
    else:
        # Identifier (variable name style)
        char_key = key_part
    
    val = compute_arith(val_part)
    if val is None:
        print(f"  SKIP cannot compute val: {repr(val_part)} for key={repr(key_part)}")
        continue
    
    R_map[char_key] = val

print(f"\nFULL R_map now has {len(R_map)} entries:")
R_reverse = {}
for char, val in sorted(R_map.items(), key=lambda x: x[1]):
    disp = repr(char) if char.isprintable() else f'chr({ord(char):02x})'
    print(f"  R[{disp:>15}] = {val:2d}")
    R_reverse[val] = char

all_vals = set(R_map.values())
missing_vals = [v for v in range(64) if v not in all_vals]
print(f"\nMissing values (0-63): {missing_vals} ({len(missing_vals)} values)")
print(f"Missing chars (printable guesses from standard b64):")

standard_b64_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
for v in missing_vals:
    std_char = standard_b64_chars[v]
    if std_char in R_map:
        std_char_val = R_map[std_char]
        print(f"  value {v}: std char='{std_char}' -> but it has value {std_char_val}")
    else:
        # Which chars are NOT in R_map keys?
        not_in_R = [c for c in standard_b64_chars if c not in R_map]
        if not_in_R:
            print(f"  value {v}: candidate chars not in R_map = {not_in_R[:10]}...")

# Now find ALL entries that have value missing from R_reverse
chars_not_in_R = [c for c in standard_b64_chars if c not in R_map]
print(f"\nStandard base64 chars NOT yet in R_map: {chars_not_in_R}")
print(f"Number missing chars: {len(chars_not_in_R)}, missing values: {len(missing_vals)}")

# Try 1:1 mapping in order
if len(chars_not_in_R) == len(missing_vals):
    print(f"\nPerfect 1:1 match - assigning in alphabetical order!")
    for i, v in enumerate(sorted(missing_vals)):
        c = chars_not_in_R[i]
        print(f"  R['{c}'] = {v}")
        R_map[c] = v
        R_reverse[v] = c

# Verify
print(f"\nR_map size after completion: {len(R_map)}")
missing_final = [v for v in range(64) if v not in R_reverse]
print(f"Still missing values: {missing_final}")

# ============================================
# NOW DECODE T WITH COMPLETE R_map
# ============================================
def custom_b64_decode(s):
    result = bytearray()
    d = 0
    digit_count = 0
    for c in s:
        if c == '=':
            if digit_count > 0:
                if digit_count >= 2:
                    b1 = d // 65536
                    result.append(b1 & 0xFF)
                if digit_count >= 3:
                    b2 = (d % 65536) // 256
                    result.append(b2 & 0xFF)
            break
        if c in R_map:
            digit_val = R_map[c]
            multiplier = 64 ** (3 - digit_count)
            d += digit_val * multiplier
            digit_count += 1
            if digit_count == 4:
                b1 = d // 65536
                b2 = (d % 65536) // 256
                b3 = d % 256
                result.append(b1 & 0xFF)
                result.append(b2 & 0xFF)
                result.append(b3 & 0xFF)
                d = 0
                digit_count = 0
    return bytes(result)

# Extract T table
full_T_pattern = r'local T=\{(.*?)\};'
T_match = re.search(full_T_pattern, line2, re.DOTALL)
T_entries_str = []
if T_match:
    T_content = T_match.group(1)
    T_entries_str = re.findall(r'"((?:[^"\\]|\\.)*)"', T_content)

print(f"\nTotal T entries: {len(T_entries_str)}")

# Decode all T entries
T_decoded = []
good_count = 0
for i, entry_str in enumerate(T_entries_str):
    entry_dec = decode_lua_escapes(entry_str)
    dec_bytes = custom_b64_decode(entry_dec)
    T_decoded.append(dec_bytes)
    if len(dec_bytes) > 0:
        good_count += 1

print(f"T entries decoded non-empty: {good_count}/{len(T_entries_str)}")

# Display T[33] and surrounding entries (which had 'htt' before)
print("\n" + "=" * 70)
print("DECODED T ENTRIES - SHOWING ALL WITH > 50% PRINTABLE")
print("=" * 70)

all_printable_runs = []
keywords_found = set()

for i, b in enumerate(T_decoded):
    if not b:
        continue
    latin_text = b.decode('latin-1', errors='replace')
    
    # Scan for printable runs
    run = []
    for c in latin_text:
        if c.isprintable() or c in '\n\r\t':
            run.append(c)
        else:
            if len(run) >= 4:
                run_str = ''.join(run)
                all_printable_runs.append((i, len(b), run_str))
            run = []
    if len(run) >= 4:
        run_str = ''.join(run)
        all_printable_runs.append((i, len(b), run_str))
    
    # Overall printable check
    printable = sum(1 for c in latin_text if c.isprintable() or c in '\n\r\t')
    ratio = printable / max(1, len(latin_text))
    
    # Show entries with keywords
    lower = latin_text.lower()
    kws = []
    for kw in ['http', 'key', 'sys', 'game', 'serv', 'httpget', 'httppost', 'request',
              'loadstr', 'player', 'worksp', 'gui', 'tween', 'coreg', 'render',
              'valid', 'check', 'auth', 'login', 'api', 'discord', '.fun', '.com',
              'FREE-', 'free-', '-SYS-']:
        if kw in lower:
            kws.append(kw)
            keywords_found.add((kw, i))
    
    hex_preview = ' '.join(f'{x:02x}' for x in b[:30])
    
    if kws or (ratio > 0.6 and len(latin_text) > 5):
        disp = ''.join(c if c.isprintable() else '.' for c in latin_text[:150])
        if kws:
            print(f"\nT[{i:3d}] ({len(b):3d}b) KW={kws} PRINT={ratio:.2f}")
        else:
            print(f"\nT[{i:3d}] ({len(b):3d}b) PRINT={ratio:.2f}")
        print(f"  HEX[:30]: {hex_preview}")
        print(f"  TEXT: {disp}")

# Print all printable runs found
print(f"\nTotal printable runs >= 4 chars: {len(all_printable_runs)}")
if len(all_printable_runs) < 100:
    for idx, total_b, run in all_printable_runs:
        print(f"  T[{idx}] (total {total_b}b): {repr(run[:120])}")
else:
    # Just show longest runs
    all_printable_runs.sort(key=lambda x: -len(x[2]))
    for idx, total_b, run in all_printable_runs[:60]:
        print(f"  T[{idx}] (total {total_b}b, run {len(run)}ch): {repr(run[:150])}")

# Show keyword hit summary
print(f"\n=== KEYWORD HITS SUMMARY ===")
for kw, idx in sorted(keywords_found):
    b = T_decoded[idx]
    txt = b.decode('latin-1', errors='replace')
    # Find and show 80 char window around keyword
    pos = txt.lower().find(kw.lower())
    if pos >= 0:
        window_start = max(0, pos - 20)
        window_end = min(len(txt), pos + 60)
        disp = ''.join(c if c.isprintable() else '.' for c in txt[window_start:window_end])
        print(f"  '{kw}' in T[{idx}] at pos {pos}: ...{disp}...")

# Save decoded T to binary concatenated
all_bytes = b''
for b in T_decoded:
    if b:
        all_bytes += b

# Search for specific patterns as byte sequences
print("\n=== HARD PATTERN SEARCH ===")
search_patterns = [
    b'FREE-SYS', b'FREE-', b'SYS-', b'http', b'https',
    b'syshub', b'SysHub', b'.fun/', b'getkey', b'GetKey',
    b'VALID', b'VALIDATE', b'auth', b'AUTH',
    b'game:GetService', b'HttpGet', b'HttpPost',
    b'loadstring', b'REQUIRE_KEY', b'KEY_', b'_KEY'
]
for pat in search_patterns:
    pos = all_bytes.find(pat)
    if pos >= 0:
        start = max(0, pos - 30)
        end = min(len(all_bytes), pos + 80)
        window = all_bytes[start:end].decode('latin-1', errors='replace')
        disp = ''.join(c if c.isprintable() else '.' for c in window)
        print(f"FOUND bytes {pat.decode('latin-1')!r} at concat pos {pos}: ...{disp}...")
    else:
        pass  # Not found - suppress noise

# Also try: maybe the custom b64 is reversed mapping?
# Try: if digit = 63 - val, decode again
print("\n=== INVERSE MAPPING TRY (digit = 63 - R[char]) ===")
R_map_inv = {}
for c, v in R_map.items():
    R_map_inv[c] = 63 - v

def custom_b64_decode_inv(s):
    result = bytearray()
    d = 0
    digit_count = 0
    for c in s:
        if c == '=':
            if digit_count > 0:
                if digit_count >= 2:
                    b1 = d // 65536
                    result.append(b1 & 0xFF)
                if digit_count >= 3:
                    b2 = (d % 65536) // 256
                    result.append(b2 & 0xFF)
            break
        if c in R_map_inv:
            digit_val = R_map_inv[c]
            multiplier = 64 ** (3 - digit_count)
            d += digit_val * multiplier
            digit_count += 1
            if digit_count == 4:
                b1 = d // 65536
                b2 = (d % 65536) // 256
                b3 = d % 256
                result.append(b1 & 0xFF)
                result.append(b2 & 0xFF)
                result.append(b3 & 0xFF)
                d = 0
                digit_count = 0
    return bytes(result)

inv_good = 0
inv_keywords = 0
for i, entry_str in enumerate(T_entries_str):
    entry_dec = decode_lua_escapes(entry_str)
    dec_bytes = custom_b64_decode_inv(entry_dec)
    if len(dec_bytes) > 0:
        inv_good += 1
        latin = dec_bytes.decode('latin-1', errors='replace')
        lower = latin.lower()
        for kw in ['http', 'game:', 'serv', 'local ', 'return', 'function']:
            if kw in lower:
                inv_keywords += 1
                if inv_keywords < 5:
                    disp = ''.join(c if c.isprintable() else '.' for c in latin[:150])
                    print(f"  INVERSE T[{i}] KW '{kw}': {disp}")
                break

print(f"Inverse mapping: {inv_good} non-empty entries, {inv_keywords} keyword hits")

# Save full decoded binary
with open(r'c:\Users\Hype\Desktop\temp\syshub_all_decoded.bin', 'wb') as f:
    for i, b in enumerate(T_decoded):
        if b:
            header = f"\n=== T[{i}] ({len(b)} bytes) ===\n".encode()
            f.write(header)
            f.write(b)

print(f"\nAll decoded T entries saved to syshub_all_decoded.bin")
