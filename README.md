# KIBT Attendance Management System (KIBT-AMS)

**Version 2.0** | Kenya Institute of Business Training | Ministry of Cooperatives and MSME Development

A cross-platform desktop application (Windows, macOS, Linux) that digitises KIBT training attendance registers using a three-layer AI scanning pipeline. Replaces manual re-typing of paper sheets into Excel.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  React 18 + TypeScript + Tailwind CSS        │  ← All screens and UI
├─────────────────────────────────────────────┤
│  Tauri 2.x Framework                         │  ← Desktop shell, file dialogs, updater
├─────────────────────────────────────────────┤
│  Rust Backend                                │  ← Database, scanning, exports
│  ├── SQLite (rusqlite)                        │  ← kibt.db — all participant data
│  ├── Google Gemini 2.0 Flash API (reqwest)   │  ← Online scan — ~95% accuracy (free)
│  └── OpenCV + Tesseract 5 (offline)          │  ← Offline scan — ~85-92% accuracy
└─────────────────────────────────────────────┘
```

### Scan Method Selection Chain
```
Internet available? ──YES──→ Gemini 2.0 Flash API (free, ~95%+)
       │
      NO
       │
       ▼
OpenCV + Tesseract 5 (~85-92%)
       │
   Image unreadable?
       │
       ▼
Manual entry fallback (always available)
```

---

## Prerequisites

### All platforms
- [Node.js 18+](https://nodejs.org)
- [Rust 1.75+](https://rustup.rs)
- [Tauri CLI 2.x](https://tauri.app): `cargo install tauri-cli@^2`

### Linux (Ubuntu/Debian)
```bash
sudo apt install \
  libwebkit2gtk-4.1-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libopencv-dev libtesseract-dev \
  tesseract-ocr tesseract-ocr-eng \
  libsecret-1-dev pkg-config
```

### Linux (Arch)
```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget \
  openssl gtk3 libappindicator-gtk3 librsvg \
  opencv tesseract tesseract-data-eng \
  libsecret pkgconf
```

### Windows
1. Install [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/) with the "C++ build tools" workload
2. Install [OpenCV 4.9](https://opencv.org/releases/) and set `OPENCV_DIR=C:\opencv\build`
3. Install [Tesseract 5](https://github.com/UB-Mannheim/tesseract/wiki) (UB Mannheim build) and set `TESSERACT_DIR=C:\Program Files\Tesseract-OCR`
4. Download `eng.traineddata` from [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) → `assets/tessdata/eng.traineddata`

### macOS
```bash
brew install opencv tesseract tesseract-lang
# eng.traineddata is included in the brew package
```

---

## Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/kibt-ict/kibt-ams.git
cd kibt-ams

# 2. Install Node.js dependencies
npm install

# 3. Download Tesseract English LSTM model (if not already present)
mkdir -p assets/tessdata
curl -L "https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata" \
  -o assets/tessdata/eng.traineddata

# 4. Start development server (hot-reloads both React and Rust)
npm run tauri:dev
```

---

## Production Build

```bash
# Build installers for the current platform
npm run tauri:build
```

Output locations:
- **Windows**: `src-tauri/target/release/bundle/nsis/KIBT-AMS-Setup-2.0.0.exe`
- **Linux .deb**: `src-tauri/target/release/bundle/deb/kibt-ams_2.0.0_amd64.deb`
- **Linux AppImage**: `src-tauri/target/release/bundle/appimage/kibt-ams_2.0.0_amd64.AppImage`
- **macOS .dmg**: `src-tauri/target/release/bundle/dmg/KIBT-AMS_2.0.0_x64.dmg`

---

## First-Time Setup (End Users)

1. Install the application using the platform installer above
2. Launch **KIBT-AMS**
3. Open **Settings** → paste your free Gemini API key
   - Get one free at [aistudio.google.com](https://aistudio.google.com) — no credit card needed
4. Set your default region in Settings
5. Create your first event under **Events**
6. Photograph an attendance sheet and test the scan under **Scan Sheet**

---

## Project Structure

```
kibt-ams/
├── src-tauri/               ← Rust backend
│   ├── src/
│   │   ├── main.rs          ← Tauri entry point, command registration
│   │   ├── db.rs            ← SQLite connection, schema, migrations, seed data
│   │   ├── events.rs        ← Event CRUD + Kenya FY computation
│   │   ├── participants.rs  ← Participant CRUD + bulk insert
│   │   ├── reports.rs       ← SQL aggregation for annual reports
│   │   ├── export.rs        ← Excel (.xlsx) and CSV generation
│   │   ├── config.rs        ← Settings + OS keychain (Gemini API key)
│   │   └── scan/
│   │       ├── mod.rs       ← Scan orchestrator (single + batch)
│   │       ├── gemini.rs    ← Gemini 2.0 Flash API client
│   │       ├── batch.rs     ← Batch queue manager + progress events
│   │       └── offline/
│   │           ├── mod.rs       ← Offline pipeline entry point
│   │           ├── preprocess.rs← OpenCV: deskew, CLAHE, binarise
│   │           ├── grid.rs      ← Table grid detection, cell cropping
│   │           ├── ocr.rs       ← Tesseract 5 LSTM per cell
│   │           └── parser.rs    ← Field normalisation (phone, gender, age)
│   ├── tauri.conf.json      ← Tauri config (window, bundle, updater)
│   ├── capabilities/
│   │   └── default.json     ← Tauri 2 capability permissions
│   └── Cargo.toml           ← Rust dependencies
│
├── src/                     ← React frontend
│   ├── main.tsx             ← React entry point
│   ├── App.tsx              ← Router, startup effects
│   ├── index.css            ← Tailwind directives + component classes
│   ├── types/index.ts       ← TypeScript interfaces (mirrors Rust structs)
│   ├── store/index.ts       ← Zustand global state (FY selector, toasts)
│   ├── hooks/useTauri.ts    ← Typed wrappers for all Tauri invoke calls
│   ├── components/
│   │   ├── Layout.tsx       ← Sidebar navigation + connectivity indicator
│   │   ├── FYSelector.tsx   ← Financial year dropdown (sidebar)
│   │   ├── PageHeader.tsx   ← Reusable page title bar
│   │   └── ToastContainer.tsx← Toast notification system
│   └── pages/
│       ├── Dashboard.tsx    ← FY statistics overview
│       ├── Events.tsx       ← Create/view/delete events
│       ├── ScanSheet.tsx    ← Single + batch scan with review table
│       ├── Participants.tsx ← Searchable database with inline edit
│       ├── Reports.tsx      ← Annual statistical report
│       ├── Export.tsx       ← Excel and CSV download
│       └── Settings.tsx     ← API key, preferences, backup/restore
│
├── assets/
│   ├── tessdata/eng.traineddata ← Tesseract 5 LSTM model (~10 MB, not in git)
│   └── kibt_form_template.png  ← Blank KIBT form (for OpenCV template alignment)
│
├── package.json
├── tailwind.config.ts
├── vite.config.ts
└── tsconfig.json
```

---

## Database

The database is a single SQLite file:
- **Windows**: `%APPDATA%\kibt-ams\kibt.db`
- **Linux**: `~/.config/kibt-ams/kibt.db`
- **macOS**: `~/Library/Application Support/kibt-ams/kibt.db`

**Backup**: Copy the `.db` file (or use Settings → Backup Database).
**Restore**: Replace the `.db` file (or use Settings → Restore from Backup).

### Schema

| Table | Purpose |
|---|---|
| `events` | One training session at one venue on one date |
| `participants` | One person's attendance record per event |
| `scans` | Audit log of every photograph upload and extraction |
| `regions` | Pre-populated KIBT regional offices |
| `app_config` | Key-value settings (API key stored in OS keychain, not here) |

---

## Kenya Financial Year Rule

```
if event month >= July:  FY = year/year+1     (e.g. Aug 2024 → 2024/2025)
if event month < July:   FY = year-1/year     (e.g. Mar 2025 → 2024/2025)
```

---

## Target Hardware

| Profile | Machine | RAM | Offline Scan Time |
|---|---|---|---|
| A | HP ProBook x360 11 G2 (Arch Linux) | 8 GB | 8–20 seconds |
| B | HP Desktop i5-6400 (Windows) | 4 GB | 10–30 seconds |

Peak RAM during offline scan: ~130 MB overhead on top of OS and app idle usage.
A large vision model (Moondream2, LLaVA) cannot run on 4 GB — this is why OpenCV+Tesseract was chosen.

---

## Scan Accuracy

| Condition | Method | Accuracy |
|---|---|---|
| Internet, clear photo | Gemini 2.0 Flash | ~95–98% |
| Internet, messy handwriting | Gemini 2.0 Flash | ~88–94% |
| Offline, clear photo | OpenCV + Tesseract 5 | ~85–92% |
| Offline, poor lighting | OpenCV + Tesseract 5 | ~70–85% |
| Offline, very messy writing | OpenCV + Tesseract 5 | ~60–75% |

---

## All Tools Are Free

| Tool | Licence | Cost |
|---|---|---|
| Tauri 2.x | MIT/Apache 2.0 | Free |
| React 18 | MIT | Free |
| Rust | MIT/Apache 2.0 | Free |
| SQLite | Public Domain | Free |
| OpenCV 4.9 | Apache 2.0 | Free |
| Tesseract 5 | Apache 2.0 | Free |
| Google Gemini 2.0 Flash | Google API ToS | Free (1500 req/day) |

---

## Roadmap

- **Phase 1 (Months 1–3)**: Core system — scaffold, events, manual entry, online scan, offline scan, reports, export ✅
- **Phase 2 (Months 4–6)**: Template alignment, duplicate detection, batch scan, PDF report, multi-year trends, Swahili UI
- **Phase 3 (Optional)**: Supabase cloud sync, HQ web dashboard

---

*KIBT ICT Department · Ministry of Cooperatives and MSME Development · Kenya*
# KIBT-AMS
# KIBT-AMS
