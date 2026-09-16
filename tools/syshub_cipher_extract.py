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

print(f"line2 length = {len(line2)}")

print("=" * 70)
print("STEP 1: EXTRACT STRUCTURE AROUND local X=string.char (pos 30000-36000)")
print("=" * 70)

# Bagian X=string.char ada di sekitar 30199
chunk1 = line2[29500:37000]
# Formatting untuk readability
formatted1 = chunk1.replace(';', ';\n').replace('end ', 'end\n ').replace(' do ', ' do\n ').replace(' then ', ' then\n ')
print(formatted1[:4000])

print("\n" + "=" * 70)
print("STEP 2: EXTRACT TABLE R WITH BROADER PATTERN")
print("=" * 70)

# Cari semua pola local ... = { yang diikuti oleh N=, r=, k= dll
R_start = line2.find('local R={')
if R_start < 0:
    R_start = line2.find('R={')
print(f"R table start pos: {R_start}")
if R_start > 0:
    # Extract sampai ketemu };
    depth = 0
    i = R_start
    started = False
    while i < min(R_start + 10000, len(line2)):
        c = line2[i]
        if c == '{':
            depth += 1
            started = True
        elif c == '}':
            depth -= 1
            if started and depth == 0:
                break
        i += 1
    R_full = line2[R_start:i+1]
    print(f"R extracted length = {len(R_full)}")
    print(R_full[:3000])
    
    # Sekarang ekstrak semua pola arithmetic di dalam R
    print("\n--- Computed X() char values from table R ---")
    arith_pat = r'(-?\d+)(\+-?\d+)'
    key_val_pairs = R_full.split(';')
    computed_R = {}
    for pair in key_val_pairs:
        pair = pair.strip()
        if '=' in pair:
            kv = pair.split('=', 1)
            k = kv[0].strip().strip('{}')
            v = kv[1].strip()
            m = re.match(r'^(-?\d+)(\+-?\d+)$', v)
            if m:
                a = int(m.group(1))
                b_str = m.group(2).replace('+-', '-')
                total = a + int(b_str)
                char = chr(total) if 0 <= total <= 255 else f'<{total}>'
                computed_R[k] = (total, char)
                display = repr(char) if char and isinstance(char, str) and len(char) == 1 and 32 <= ord(char) <= 126 else f'chr({total})'
                print(f"  R[{k:>12}] = X({total:>5}) = {display}")
    
    # Coba spell: rangkum karakter printable yang berurutan
    sorted_vals = sorted(computed_R.items(), key=lambda x: x[1][0])
    print("\n--- All chars in ASCII order ---")
    printable_seq = []
    for k, (code, c) in sorted_vals:
        if isinstance(c, str) and len(c) == 1 and 32 <= ord(c) <= 126:
            printable_seq.append(c)
    print("Printable sequence: " + ''.join(printable_seq))

print("\n" + "=" * 70)
print("STEP 3: EXTRACT ALL CIPHER HELPER FUNCTIONS AROUND pos 29000")
print("=" * 70)

chunk2 = line2[28500:31500]
formatted2 = chunk2.replace(';', ';\n').replace('end', 'end\n').replace('do ', 'do\n ').replace('then ', 'then\n ')
print(formatted2[:3000])

print("\n" + "=" * 70)
print("STEP 4: LOOK FOR THE T LOOKUP X FUNCTION (before local X=string.char)")
print("=" * 70)

chunk3 = line2[26000:30500]
# Cari local function X
X_matches = list(re.finditer(r'local\s+function\s+X|function\s+X|X\s*=\s*function', chunk3))
print(f"X function-like matches in range: {len(X_matches)}")
for m in X_matches:
    start = max(0, m.start() - 100)
    end = min(len(chunk3), m.end() + 200)
    print(f"\n--- Match at {m.start()} in chunk (abs {26000+m.start()}) ---")
    print(chunk3[start:end])

print("\n" + "=" * 70)
print("STEP 5: CHECK FOR A POLYALPHABETIC/VIGENERE LIKE CIPHER")
print("=" * 70)

# Kita punya banyak base64-decoded bytes di tabel T
# String T[0] setelah base64 = b'\xb4\x87\x4a' (3 bytes)
# Mari cek X function sebagai string.char dan kemungkinan cipher key

# Coba ekstrak T[0..20] bytes mentah lalu cek XOR dengan kemungkinan key
full_T_pattern = r'local T=\{(.*?)\};'
T_match = re.search(full_T_pattern, line2, re.DOTALL)
if T_match:
    T_content = T_match.group(1)
    T_entries = re.findall(r'"((?:[^"\\]|\\.)*)"', T_content)
    
    T_bytes = []
    for i, entry in enumerate(T_entries[:50]):
        dec = decode_lua_escapes(entry)
        try:
            b = base64.b64decode(dec)
            T_bytes.append(b)
            hex_str = ' '.join(f'{x:02x}' for x in b[:20])
            print(f"T[{i:3d}] ({len(b):3d} bytes) hex: {hex_str}")
        except Exception as e:
            T_bytes.append(None)
            print(f"T[{i:3d}] B64 ERROR: {e}")
    
    # Cek apakah T[0..3] byte berurutan adalah ASCII printable jika di XOR
    print("\n--- XOR brute force T[0] bytes ---")
    if T_bytes[0]:
        for xor_key in range(256):
            result = bytes(b ^ xor_key for b in T_bytes[0])
            if all(32 <= c <= 126 for c in result):
                print(f"  XOR 0x{xor_key:02x}: {result.decode('ascii')}")
    
    # Cek T[0] dengan key yang berurutan jika T[0..3] adalah kunci
    print("\n--- If first bytes are cipher key chars (table R map) ---")
    if all(T_bytes[i] is not None for i in range(5)):
        first_bytes = [b[0] for b in T_bytes[:20] if b is not None and len(b) > 0]
        hex_fb = ' '.join(f'{x:02x}' for x in first_bytes)
        print(f"First byte of each T entry: {hex_fb}")
        # Coba sebagai string
        printable = ''.join(chr(b) for b in first_bytes if 32 <= b <= 126)
        print(f"As printable ASCII: {printable}")
