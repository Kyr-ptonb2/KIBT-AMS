#!/usr/bin/env bash
# KIBT-AMS Linux dependency installer (Ubuntu 22.04 / 24.04 tested)
set -e
echo "=== KIBT-AMS Linux Setup ==="

if command -v apt-get &>/dev/null; then
    sudo apt-get update -q
    sudo apt-get install -y \
        build-essential curl wget pkg-config \
        libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev \
        libayatana-appindicator3-dev librsvg2-dev libsecret-1-dev \
        libopencv-dev libtesseract-dev tesseract-ocr tesseract-ocr-eng
elif command -v pacman &>/dev/null; then
    sudo pacman -Sy --noconfirm base-devel webkit2gtk-4.1 openssl gtk3 \
        libappindicator-gtk3 librsvg libsecret pkgconf \
        opencv tesseract tesseract-data-eng
fi

if ! command -v rustc &>/dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

cargo install tauri-cli@'^2' --locked

mkdir -p assets/tessdata
if [ ! -f "assets/tessdata/eng.traineddata" ]; then
    curl -L "https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata" \
        -o assets/tessdata/eng.traineddata
fi

echo "Done! Run: npm install && npm run tauri:dev"
