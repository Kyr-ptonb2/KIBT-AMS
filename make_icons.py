import struct, zlib, os, shutil

def make_rgba_png(size, r, g, b):
    def u32(n): return struct.pack('>I', n)
    def chunk(tag, data):
        return u32(len(data)) + tag + data + u32(zlib.crc32(tag + data) & 0xffffffff)
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    row  = b'\x00' + bytes([r, g, b, 255] * size)
    idat = chunk(b'IDAT', zlib.compress(row * size, 9))
    iend = chunk(b'IEND', b'')
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend

def make_ico(sizes, r, g, b):
    images = [(s, make_rgba_png(s, r, g, b)) for s in sizes]
    count = len(images)
    header = struct.pack('<HHH', 0, 1, count)
    offset = 6 + count * 16
    entries = []
    data = []
    for (s, png) in images:
        w = 0 if s >= 256 else s
        entries.append(struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(png), offset))
        data.append(png)
        offset += len(png)
    return header + b''.join(entries) + b''.join(data)

os.makedirs('src-tauri/icons', exist_ok=True)

# Write proper ICO (16, 32, 48, 256 sizes)
ico = make_ico([16, 32, 48, 256], 26, 107, 60)
with open('src-tauri/icons/icon.ico', 'wb') as f:
    f.write(ico)

# Write PNGs
for name, size in [('32x32', 32), ('128x128', 128), ('128x128@2x', 256)]:
    with open(f'src-tauri/icons/{name}.png', 'wb') as f:
        f.write(make_rgba_png(size, 26, 107, 60))

# icon.icns = copy of 128x128 PNG (works for dev builds)
shutil.copy('src-tauri/icons/128x128.png', 'src-tauri/icons/icon.icns')

print("Icons created successfully!")
print("ICO size:", len(ico), "bytes")
print("Files:", os.listdir('src-tauri/icons'))
