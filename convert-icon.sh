#!/bin/bash
# Convert KIBT-AMS icon.svg to required formats

set -e

SVG_FILE="kibt-ams-icon.svg"
OUTPUT_DIR="src-tauri/icons"

echo "Converting KIBT-AMS icon to required formats..."

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "ImageMagick is not installed. Installing..."
    sudo pacman -S imagemagick --noconfirm
fi

# Create temporary PNG at various sizes
echo "Creating PNG versions..."
convert -density 384 -background none "$SVG_FILE" -resize 256x256 "$OUTPUT_DIR/icon.png"
convert -density 384 -background none "$SVG_FILE" -resize 512x512 "$OUTPUT_DIR/icon-512x512.png"
convert -density 384 -background none "$SVG_FILE" -resize 1024x1024 "$OUTPUT_DIR/icon-1024x1024.png"

# Create ICO for Windows
echo "Creating ICO for Windows..."
convert "$OUTPUT_DIR/icon.png" -define icon:auto-resize=256,128,96,64,48,32,16 "$OUTPUT_DIR/icon.ico"

# Create ICNS for macOS (requires multiple sizes)
echo "Creating ICNS for macOS..."
mkdir -p /tmp/icon.iconset
convert -density 384 -background none "$SVG_FILE" -resize 16x16 /tmp/icon.iconset/icon_16x16.png
convert -density 384 -background none "$SVG_FILE" -resize 32x32 /tmp/icon.iconset/icon_16x16@2x.png
convert -density 384 -background none "$SVG_FILE" -resize 32x32 /tmp/icon.iconset/icon_32x32.png
convert -density 384 -background none "$SVG_FILE" -resize 64x64 /tmp/icon.iconset/icon_32x32@2x.png
convert -density 384 -background none "$SVG_FILE" -resize 128x128 /tmp/icon.iconset/icon_128x128.png
convert -density 384 -background none "$SVG_FILE" -resize 256x256 /tmp/icon.iconset/icon_128x128@2x.png
convert -density 384 -background none "$SVG_FILE" -resize 256x256 /tmp/icon.iconset/icon_256x256.png
convert -density 384 -background none "$SVG_FILE" -resize 512x512 /tmp/icon.iconset/icon_256x256@2x.png
convert -density 384 -background none "$SVG_FILE" -resize 512x512 /tmp/icon.iconset/icon_512x512.png
convert -density 384 -background none "$SVG_FILE" -resize 1024x1024 /tmp/icon.iconset/icon_512x512@2x.png

# Convert iconset to ICNS (if iconutil is available on macOS)
if command -v iconutil &> /dev/null; then
    iconutil -c icns /tmp/icon.iconset -o "$OUTPUT_DIR/icon.icns"
    echo "✓ ICNS created successfully"
else
    echo "⚠ iconutil not available (macOS only). Skipping ICNS creation."
    echo "  On macOS, run: iconutil -c icns /tmp/icon.iconset -o src-tauri/icons/icon.icns"
fi

# Cleanup
rm -rf /tmp/icon.iconset

echo ""
echo "✓ Icon conversion complete!"
echo "Files created:"
ls -lh "$OUTPUT_DIR"/icon*
echo ""
echo "Next steps:"
echo "1. The app will use the new icons automatically"
echo "2. Rebuild the app: npm run tauri:dev"
echo "3. Icons will appear in the taskbar and window title"
