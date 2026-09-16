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

X_OFFSET = 737202 - 707742  # = 29460
print(f"X-lookup offset = T[X + {X_OFFSET}]")

# STEP 1: Extract and compute FULL table R
R_full = "local R={N=820874+-820857;r=-1017125-(-1017183);k=-564392-(-564443);[\"\\043\"]=-730111+730131;w=947785+-947753;P=102557+-102508;[\"\\050\"]=219461-219400;[\"\\054\"]=449467-449422;v=745145+-745133,q=-819909+819939,W=777832+-777786;F=-979259+979313;Z=-206545+206572;Q=-503076+503102,A=595098-595041,x=581623+-581619,f=557914+-557911;[\"\\057\"]=-70430+70465;O=837614-837612,[\"\\055\"]=-977312-(-977341);B=-914164-(-914185);[\"\\051\"]=159604-159594;l=-495893-(-495934),n=-892759+892764;Y=-630265-(-630328);u=52876+-52869;X=-639337+639373;H=-507348+507372;m=886729+-886714;h=-847671-(-847714);i=-536848+536848,b=383307-383291;d=-466033-(-466052);[\"\\056\"]=-164941-(-164954);o=400192+-400148;L=708243-708206,t=956088-956032;p=569415+-569363,g=-213596-(-213655),V=-627578-(-627633);K=125388+-125355;[\"\\047\"]=1027325+-1027319,E=-698773+698782,[\"\\053\"]=-272906-(-272945),G=-119156-(-119174),S=-635493+635504;J=-535789+535797;D=350114+-350054;M=316342-316314;c=781419+-781388;e=-225439+225464;s=114873-114859;T=352711+-352673,a=-126117-(-126170),U=631207+-631160,R=-972287-(-972335),j=-905025+905067,[\"\\049\"]=157365+-157342,I=-541413-(-541463);[\"\\048\"]=1022788+-1022787;z=-321955+321977,[\"\\052\"]=920986+-920946,y=-967920-(-967982),C=563158+-563124}"

def compute_arith(expr):
    expr = expr.strip()
    m = re.match(r'^(-?\d+)(\+-?\d+)$', expr)
    if m:
        a = int(m.group(1))
        b_str = m.group(2).replace('+-', '-')
        return a + int(b_str)
    return None

# Parse table R
R_map = {}  # char -> base64 digit value (0-63)
R_entries = R_full[len('local R={'):-1].split(';')
for entry in R_entries:
    for sub_entry in entry.split(','):
        sub_entry = sub_entry.strip()
        if '=' in sub_entry:
            parts = sub_entry.split('=', 1)
            key = parts[0].strip()
            val_expr = parts[1].strip()
            val = compute_arith(val_expr)
            if val is not None:
                if key.startswith('["') and key.endswith('"]'):
                    key_str = key[2:-2]
                    char = decode_lua_escapes(key_str)
                else:
                    char = key
                R_map[char] = val

print(f"\nTable R complete mapping (char -> base64 value):")
R_reverse = {}  # value -> char
for char, val in sorted(R_map.items(), key=lambda x: x[1]):
    display_char = repr(char) if char.isprintable() else f'esc({ord(char):02x})'
    print(f"  R[{display_char:>12}] = {val:2d}  (0b{val:06b})")
    R_reverse[val] = char

print(f"\nTotal R entries: {len(R_map)} / 64 standard base64 chars")

# Check what values are missing
all_vals = set(R_map.values())
missing = [v for v in range(64) if v not in all_vals]
print(f"Missing values in R (0-63): {missing}")

# STEP 2: Extract T table
full_T_pattern = r'local T=\{(.*?)\};'
T_match = re.search(full_T_pattern, line2, re.DOTALL)
T_entries_str = []
if T_match:
    T_content = T_match.group(1)
    T_entries_str = re.findall(r'"((?:[^"\\]|\\.)*)"', T_content)

print(f"\nTotal T entries extracted: {len(T_entries_str)}")

# STEP 3: Apply CUSTOM BASE64 DECODER to ALL T entries
def custom_b64_decode(s):
    """Custom base64 decoder using R_map (R[char] = 6-bit value)
    Algorithm from script:
    d = d + z * 64^(3-a) ; a = 0..3
    if a == 4: char(bytes d/65536, d%65536/256, d%256), reset
    """
    result = bytearray()
    d = 0  # accumulator
    digit_count = 0  # a
    for c in s:
        if c == '=':
            # Padding
            if digit_count > 0:
                # Extract remaining bytes
                if digit_count >= 2:
                    b1 = d // 65536
                    result.append(b1 & 0xFF)
                if digit_count >= 3:
                    b2 = (d % 65536) // 256
                    result.append(b2 & 0xFF)
            break
        if c in R_map:
            digit_val = R_map[c]
            # d = d + z * 64^(3 - a), where a=digit_count (0-based)
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

# Decode T entries with custom base64
T_decoded = []
for i, entry_str in enumerate(T_entries_str):
    entry_decoded_escapes = decode_lua_escapes(entry_str)
    try:
        custom_dec = custom_b64_decode(entry_decoded_escapes)
        T_decoded.append(custom_dec)
    except Exception as e:
        T_decoded.append(None)
        print(f"T[{i}] custom decode ERROR: {e}")

print("\n" + "=" * 70)
print("STEP 4: CUSTOM BASE64 DECODED T ENTRIES (first 60)")
print("=" * 70)

printable_found = []
for i in range(min(len(T_decoded), 60)):
    b = T_decoded[i]
    if b is None:
        print(f"T[{i:3d}] = NONE")
        continue
    hex_str = ' '.join(f'{x:02x}' for x in b[:20])
    try:
        text = b.decode('utf-8', errors='replace')
    except:
        text = b.decode('latin-1', errors='replace')
    printable_ratio = sum(1 for c in text if c.isprintable() or c in '\n\r\t') / max(1, len(text))
    status = 'PRINT' if printable_ratio > 0.8 else 'BIN'
    preview = repr(text[:80])
    print(f"T[{i:3d}] ({len(b):3d}b) {status} {printable_ratio:.2f} | hex[:20]: {hex_str}")
    if printable_ratio > 0.5 and len(b) > 0:
        print(f"         text: {preview}")
    if printable_ratio > 0.7:
        printable_found.append((i, text, b))

# STEP 5: Now find strings at X_OFFSET range - that's where function names are
print("\n" + "=" * 70)
print("STEP 5: T AT X_OFFSET RANGE (29460+) - THESE ARE STRING LOOKUP ENTRIES")
print("=" * 70)

# Actually, X(idx) = T[idx + 29460]. But we only have ~547 T entries.
# Wait - that's the OTHER X function (the T-lookup). The X=string.char is DIFFERENT scope.
# So T entries 0-546 are DATA, and X(0) = T[0 + 29460]... but that can't be right if only 547 entries
# Wait, let me recheck:
# BEFORE local X=string.char (the cipher scope) there is:
#   local function X(X) return T[X + 29460] end
# But that function gets shadowed INSIDE the do...end block by local X=string.char
# So X(idx) = T[idx+29460] is for OUTSIDE that block.

# Actually maybe the T table is MODIFIED by the ipairs loop that runs first!
# The ipairs loop does swaps on T[B[...]] positions
# So T might be LONGER than what I extracted.
# Let me check ALL of line2 for more string entries T[X] patterns.

print(f"\nTotal T entries (from local T={{...}}): {len(T_decoded)}")
print(f"X_offset points to: 0+{X_OFFSET} = {X_OFFSET} -> but T only has {len(T_decoded)} entries")
print("This means: the IPairs swap loop runs FIRST to reorder/expand T, OR there are additional T insertions")

# Let me check the swap loop parameters
print("\n" + "=" * 70)
print("STEP 6: ANALYZE THE IPAIRS SWAP LOOP (reorders T entries)")
print("=" * 70)

swap_params = [
    (-655180 - (-655181), 320878 - 320331),  # (1, 547)
    (314698 + -314697, -62754 + 63285),      # (1, 531)
    (-255743 - (-256275), -999677 - (-1000224)),  # (532, 547)
]
print(f"Swap loop ipairs sets (start/end): {swap_params}")
computed = []
for a, b in swap_params:
    print(f"  ({a}, {b})")
    computed.extend([a, b])
print(f"  -> lengths: {computed}")

# The while loop conditions:
# B[1] < B[2]  (first < second)  -> B[1] < B[2] means it's sorting/reversing a range
# The assignment swaps T[pos1], T[pos2], B[3]+=1, B[4]-=1
# This is QUICKSORT on T using some comparison, or just reverse/shift

# Now, let me see printable entries at X_OFFSET corrected indices
# If T has only 547 entries and X_OFFSET=29460, that can't be.
# Maybe the arithmetic I got was for a DIFFERENT X function.
# Let me look again... Actually: the X function outside the do end is X(idx) = T[idx+29460]
# But the T has only 547 entries. That means X is defined BEFORE the decoder do/end block
# runs. After that block runs, there are MORE T entries created via table.insert somewhere.

# Let me check what's at position 0..20 more carefully
print("\n" + "=" * 70)
print("STEP 7: FULL DECODED T ENTRIES - LOOK FOR SERVICE NAMES / KEYWORDS")
print("=" * 70)

for i, b in enumerate(T_decoded):
    if b is None or len(b) == 0:
        continue
    # Check every possible encoding
    for enc in ['latin-1']:
        try:
            text = b.decode(enc)
            # Check standard strings: game, service, function names
            kw_lower = ['game', 'service', 'http', 'get', 'post', 'request', 'player',
                       'workspace', 'gui', 'key', 'syshub', 'free', 'script', 'loadstring',
                       'tween', 'core', 'gui', 'render', 'input', 'mouse', 'keyboard']
            hits = [kw for kw in kw_lower if kw in text.lower()]
            if hits:
                print(f"\nT[{i}] keyword hits: {hits}")
                hex_all = ' '.join(f'{x:02x}' for x in b)
                print(f"  FULL HEX: {hex_all[:300]}")
                print(f"  TEXT: {repr(text[:200])}")
                printable_found.append((i, text, b))
        except:
            pass

# Save all decoded T bytes to binary for analysis
with open(r'c:\Users\Hype\Desktop\temp\syshub_T_decoded.bin', 'wb') as f:
    for i, b in enumerate(T_decoded):
        if b:
            f.write(f'\n=== T[{i}] ({len(b)} bytes) ===\n'.encode())
            f.write(b)
            f.write(b'\n')

# Also concatenate all bytes for patterns search
all_bytes = b''
for b in T_decoded:
    if b:
        all_bytes += b

# Search for patterns as raw bytes/latin1
all_text_latin = all_bytes.decode('latin-1', errors='replace')
patterns_binary = ['FREE-SYS', 'FREE-', 'SYS-', 'http', 'syshub', 'SysHub', '.fun', 'getfenv', 
                   'game:GetService', 'string.char', 'table.insert', 'math.floor',
                   'XXTEA', 'xxtea', 'loadstring', 'HttpGet', 'HttpPost',
                   'FREE-SYS-YJS2-5ERA-D525', 'YJS2', '5ERA', 'D525']
print("\n" + "=" * 70)
print("STEP 8: SEARCH FOR KEY PATTERNS IN ALL CONCATENATED DECODED BYTES")
print("=" * 70)

for pat in patterns_binary:
    pos = all_text_latin.find(pat)
    if pos >= 0:
        start = max(0, pos - 50)
        end = min(len(all_text_latin), pos + 100)
        print(f"Found '{pat}' at position {pos}: ...{repr(all_text_latin[start:end])}...")
    else:
        print(f"Pattern '{pat}' NOT found in decoded bytes")

# STEP 9: Try XOR with key (R values 0-63 = possible cipher key)
print("\n" + "=" * 70)
print("STEP 9: XOR DECRYPT ATTEMPT - TRY REPEATING KEY OF R chars")
print("=" * 70)

# The R_map has ASCII values of chars sorted
key_candidates = []
for val in range(64):
    if val in R_reverse:
        c = R_reverse[val]
        if len(c) == 1:
            key_candidates.append(ord(c))

# Try first: T[0..N] XOR key_candidates as repeating key
for name, key_bytes in [("R_values_ordered", key_candidates)]:
    if len(key_bytes) == 0:
        continue
    # Try decrypting first 1000 bytes
    xor_result = bytearray()
    for i, b in enumerate(all_bytes[:1000]):
        xor_result.append(b ^ key_bytes[i % len(key_bytes)])
    
    result_text = xor_result.decode('latin-1', errors='replace')
    printable = sum(1 for c in result_text if c.isprintable() or c in '\n\r\t')
    ratio = printable / max(1, len(result_text))
    print(f"\n{name} key={key_bytes[:10]} len={len(key_bytes)} printable_ratio={ratio:.2f}")
    if ratio > 0.5:
        print(f"First 500 chars: {repr(result_text[:500])}")
        # Check keywords
        for kw in ['function', 'local', 'return', 'game', 'service']:
            if kw in result_text.lower():
                print(f"  KEYWORD HIT: {kw}")

print("\nDone! T decoded bytes saved to syshub_T_decoded.bin")
