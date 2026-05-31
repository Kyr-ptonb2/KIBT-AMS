// ImportParticipants.tsx — Upload CSV, Excel (.xlsx), or Google Sheets export
// Parses the file entirely in the browser (no server upload needed)
// then calls import_participants Rust command.

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  Upload, FileSpreadsheet, FileText, CheckCircle,
  AlertTriangle, X, Save, Plus, Loader, Info, Download
} from "lucide-react";
import { useStore } from "../store";
import { getEvents, getEventSessions, importParticipants } from "../hooks/useTauri";
import { BUSINESS_TYPES, KIBT_REGIONS, ParticipantInput } from "../types";
import PageHeader from "../components/PageHeader";

// ── Column mapping helpers ─────────────────────────────────────────────────────

// Map common column header names → our internal field
const COL_ALIASES: Record<string, keyof ParticipantInput> = {
  // Name
  "name": "name", "full name": "name", "participant name": "name",
  "participants' full name": "name", "participants full name": "name",
  "full_name": "name", "participant": "name",
  // Business type
  "business type": "businessType", "type of business": "businessType",
  "business": "businessType", "business_type": "businessType",
  // Age
  "age": "ageCategory", "age category": "ageCategory",
  "a=above 35 yrs or b=below 35 yrs": "ageCategory",
  "age_category": "ageCategory",
  // Gender
  "gender": "gender", "gender m\\f": "gender", "sex": "gender",
  "m/f": "gender", "gender (m/f)": "gender",
  // Phone
  "phone": "phone", "phone number": "phone", "telephone": "phone",
  "telephone no.": "phone", "mobile": "phone", "contact": "phone",
  "phone_number": "phone", "tel": "phone",
  // Location / sub-location
  "location": "location", "sub-location": "location", "area": "location",
  "sub location": "location", "sublocation": "location",
  // Region / county
  "region": "region", "county": "region", "zone": "region",
  // Consent
  "consent": "consent", "sign if you consent": "consent",
  "sign": "consent", "signature": "consent",
};

function detectField(header: string): keyof ParticipantInput | null {
  const lower = header.toLowerCase().trim();
  return COL_ALIASES[lower] ?? null;
}

function normaliseValue(field: keyof ParticipantInput, raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  switch (field) {
    case "gender":
      if (/^m/i.test(v) || v === "1") return "M";
      if (/^f/i.test(v) || v === "2") return "F";
      return "";
    case "ageCategory":
      if (/^a/i.test(v) || v === "1") return "A";
      if (/^b/i.test(v) || v === "2") return "B";
      return "";
    case "consent":
      if (/^y|^1|signed|yes/i.test(v)) return "Yes";
      return "No";
    case "businessType": {
      const l = v.toLowerCase();
      if (l.includes("sole") || l.includes("prop")) return "Sole proprietor";
      if (l.includes("partner")) return "Partnership";
      if (l.includes("limited") || l.includes("ltd")) return "Limited company";
      if (l.includes("coop")) return "Cooperative";
      if (l.includes("assoc")) return "Association";
      return v;
    }
    default:
      return v;
  }
}

type MappedRow = ParticipantInput & { _rowIndex: number; _valid: boolean };

export default function ImportParticipants() {
  const { selectedFY, addToast } = useStore();
  const qc = useQueryClient();

  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [colMap, setColMap] = useState<Record<string, keyof ParticipantInput | "skip">>({});
  const [step, setStep] = useState<"upload" | "map" | "review" | "done">("upload");
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: events } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
  });

  const { data: sessions } = useQuery({
    queryKey: ["sessions", selectedEventId],
    queryFn: () => selectedEventId ? getEventSessions(selectedEventId) : Promise.resolve([]),
    enabled: !!selectedEventId,
  });

  // ── File parsing ─────────────────────────────────────────────────────────────

  const handleFile = useCallback((f: File) => {
    setFile(f);
    const name = f.name.toLowerCase();

    if (name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const result = Papa.parse<Record<string, string>>(text, {
          header: true, skipEmptyLines: true, trimHeaders: true,
        });
        processData(result.meta.fields ?? [], result.data);
      };
      reader.readAsText(f);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
          header: 0, defval: "", raw: false,
        });
        if (json.length > 0) {
          processData(Object.keys(json[0]), json);
        }
      };
      reader.readAsArrayBuffer(f);
    }
  }, []);

  function processData(headers: string[], rows: Record<string, string>[]) {
    setRawHeaders(headers);
    setRawRows(rows);

    // Auto-detect column mapping
    const autoMap: Record<string, keyof ParticipantInput | "skip"> = {};
    headers.forEach(h => {
      const field = detectField(h);
      autoMap[h] = field ?? "skip";
    });
    setColMap(autoMap);
    setStep("map");
  }

  // ── Apply mapping → mapped rows ───────────────────────────────────────────

  function applyMapping() {
    const rows: MappedRow[] = rawRows.map((raw, idx) => {
      const row: Partial<ParticipantInput> = {};
      Object.entries(colMap).forEach(([header, field]) => {
        if (field === "skip") return;
        const val = normaliseValue(field, raw[header] ?? "");
        if (val) (row as any)[field] = val;
      });
      const valid = !!(row.name?.trim());
      return { ...row, name: row.name ?? "", _rowIndex: idx + 2, _valid: valid };
    }).filter(r => r.name.trim() !== "");

    setMappedRows(rows);
    setStep("review");
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const validRows = mappedRows.filter(r => r._valid && r.name.trim());
    if (!selectedEventId || validRows.length === 0) return;

    setSaving(true);
    try {
      const payload = validRows.map(({ _rowIndex, _valid, ...r }) => r);
      const count = await importParticipants(selectedEventId, selectedSessionId, payload);
      setSavedCount(count);
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      setStep("done");
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = () => {
    setFile(null); setRawHeaders([]); setRawRows([]);
    setMappedRows([]); setColMap({}); setStep("upload");
    setSavedCount(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const fieldOptions: Array<{ value: keyof ParticipantInput | "skip"; label: string }> = [
    { value: "skip",         label: "— Skip this column —" },
    { value: "name",         label: "Full Name" },
    { value: "businessType", label: "Business Type" },
    { value: "ageCategory",  label: "Age Category (A/B)" },
    { value: "gender",       label: "Gender (M/F)" },
    { value: "phone",        label: "Phone Number" },
    { value: "location",     label: "Location/Sub-location" },
    { value: "region",       label: "Region/County" },
    { value: "consent",      label: "Consent" },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Import Participants"
        subtitle="Upload CSV, Excel (.xlsx), or Google Sheets export"
        actions={
          step !== "upload" && (
            <button className="btn-secondary text-xs" onClick={reset}>
              <X size={13} /> Start Over
            </button>
          )
        }
      />

      <div className="px-8 py-6 space-y-5 max-w-5xl">
        {/* Progress indicator */}
        <div className="flex items-center gap-2">
          {["upload", "map", "review", "done"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s ? "bg-kibt-green text-white"
                : ["upload","map","review","done"].indexOf(step) > i ? "bg-green-200 text-green-700"
                : "bg-gray-200 text-gray-400"
              }`}>{i + 1}</div>
              <span className={`text-xs font-medium capitalize ${step === s ? "text-gray-800" : "text-gray-400"}`}>
                {s === "upload" ? "Upload File" : s === "map" ? "Map Columns" : s === "review" ? "Review" : "Done"}
              </span>
              {i < 3 && <div className="w-6 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* ── STEP 1: Upload ─────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-5">
            {/* Event + session selectors */}
            <div className="card p-5 grid grid-cols-2 gap-4">
              <div>
                <label className="label">Select Event *</label>
                <select className="select" value={selectedEventId}
                  onChange={e => { setSelectedEventId(e.target.value); setSelectedSessionId(null); }}>
                  <option value="">— Choose an event —</option>
                  {events?.map(ev => (
                    <option key={ev.id} value={ev.id}>
                      {ev.region} · {ev.startDate} · {ev.title}
                    </option>
                  ))}
                </select>
              </div>
              {sessions && sessions.length > 0 && (
                <div>
                  <label className="label">Assign to Session (optional)</label>
                  <select className="select" value={selectedSessionId ?? ""}
                    onChange={e => setSelectedSessionId(e.target.value || null)}>
                    <option value="">— No specific session —</option>
                    {sessions.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        Session {s.sessionNo}{s.title ? ` — ${s.title}` : ""} ({s.date})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Template download hint */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">Accepted formats</p>
              <div className="grid grid-cols-3 gap-3 text-xs text-blue-700">
                <div className="flex items-start gap-2">
                  <FileSpreadsheet size={14} className="mt-0.5 flex-shrink-0" />
                  <span><strong>.xlsx / .xls</strong><br/>Microsoft Excel or Google Sheets (File → Download → .xlsx)</span>
                </div>
                <div className="flex items-start gap-2">
                  <FileText size={14} className="mt-0.5 flex-shrink-0" />
                  <span><strong>.csv</strong><br/>Google Forms export, any CSV source</span>
                </div>
                <div className="flex items-start gap-2">
                  <Info size={14} className="mt-0.5 flex-shrink-0" />
    <span><strong>Column headers</strong><br/>First row must contain column names. Extra columns are preserved.<br/>
                  <a href="/import-template.csv" download className="underline text-blue-600 flex items-center gap-1 mt-1">
                    <Download size={11} /> Download template CSV
                  </a></span>
                </div>
              </div>
            </div>

            {/* Drop zone */}
            <div
              className="card border-2 border-dashed border-gray-200 hover:border-kibt-green/40 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <div className="flex flex-col items-center justify-center py-14 text-gray-400">
                <Upload size={32} className="mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-600">Drop your file here or click to browse</p>
                <p className="text-xs mt-1">.xlsx · .xls · .csv</p>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            {!selectedEventId && (
              <p className="text-xs text-amber-600 text-center">⚠ Select an event before uploading a file</p>
            )}
          </div>
        )}

        {/* ── STEP 2: Map columns ────────────────────────────────────────── */}
        {step === "map" && (
          <div className="space-y-5">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Map Your Columns</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {rawRows.length} rows found in <strong>{file?.name}</strong>.
                    Column headers were auto-detected — adjust any that are wrong.
                  </p>
                </div>
                <button className="btn-primary text-xs" onClick={applyMapping}>
                  Apply Mapping →
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium pr-4">Column in file</th>
                      <th className="pb-2 font-medium pr-4">Sample value</th>
                      <th className="pb-2 font-medium">Map to field</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rawHeaders.map(h => (
                      <tr key={h} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 font-mono text-xs text-gray-700">{h}</td>
                        <td className="py-2 pr-4 text-xs text-gray-500 max-w-48 truncate">
                          {rawRows[0]?.[h] ?? "—"}
                        </td>
                        <td className="py-2">
                          <select
                            className={`select text-xs py-1 ${colMap[h] !== "skip" ? "border-kibt-green/40 bg-green-50" : ""}`}
                            value={colMap[h] ?? "skip"}
                            onChange={e => setColMap(p => ({ ...p, [h]: e.target.value as any }))}
                          >
                            {fieldOptions.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Check required fields */}
              {!Object.values(colMap).includes("name") && (
                <div className="mt-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} /> Map at least one column to <strong>Full Name</strong> before continuing.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: Review ─────────────────────────────────────────────── */}
        {step === "review" && (
          <div className="space-y-5">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Review — {mappedRows.filter(r => r._valid).length} valid rows
                  </h3>
                  {mappedRows.some(r => !r._valid) && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      {mappedRows.filter(r => !r._valid).length} rows skipped (no name)
                    </p>
                  )}
                </div>
                <button
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={saving || mappedRows.filter(r => r._valid).length === 0}
                >
                  {saving
                    ? <><Loader size={14} className="animate-spin" /> Importing…</>
                    : <><Save size={14} /> Import {mappedRows.filter(r => r._valid).length} Participants</>
                  }
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-3 font-medium">#</th>
                      <th className="pb-2 pr-3 font-medium min-w-40">Full Name</th>
                      <th className="pb-2 pr-3 font-medium">Business Type</th>
                      <th className="pb-2 pr-3 font-medium w-12">Age</th>
                      <th className="pb-2 pr-3 font-medium w-12">Gender</th>
                      <th className="pb-2 pr-3 font-medium">Phone</th>
                      <th className="pb-2 pr-3 font-medium">Location</th>
                      <th className="pb-2 pr-3 font-medium">Region</th>
                      <th className="pb-2 font-medium w-14">Consent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {mappedRows.slice(0, 100).map((row, i) => (
                      <tr key={i} className={`hover:bg-gray-50 ${!row._valid ? "opacity-40 line-through" : ""}`}>
                        <td className="py-1.5 pr-3 text-gray-400">{row._rowIndex}</td>
                        <td className="py-1.5 pr-3 font-medium text-gray-800">{row.name}</td>
                        <td className="py-1.5 pr-3 text-gray-600">
                          <select className="table-cell-edit text-xs"
                            value={row.businessType ?? ""}
                            onChange={e => setMappedRows(prev => prev.map((r, ri) =>
                              ri === i ? {...r, businessType: e.target.value || undefined} : r
                            ))}>
                            <option value="">—</option>
                            {BUSINESS_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 pr-3">
                          <select className="table-cell-edit text-xs"
                            value={row.ageCategory ?? ""}
                            onChange={e => setMappedRows(prev => prev.map((r, ri) =>
                              ri === i ? {...r, ageCategory: e.target.value || undefined} : r
                            ))}>
                            <option value="">—</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                          </select>
                        </td>
                        <td className="py-1.5 pr-3">
                          <select className="table-cell-edit text-xs"
                            value={row.gender ?? ""}
                            onChange={e => setMappedRows(prev => prev.map((r, ri) =>
                              ri === i ? {...r, gender: e.target.value || undefined} : r
                            ))}>
                            <option value="">—</option>
                            <option value="M">M</option>
                            <option value="F">F</option>
                          </select>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-gray-600">{row.phone ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{row.location ?? "—"}</td>
                        <td className="py-1.5 pr-3">
                          <select className="table-cell-edit text-xs"
                            value={row.region ?? ""}
                            onChange={e => setMappedRows(prev => prev.map((r, ri) =>
                              ri === i ? {...r, region: e.target.value || undefined} : r
                            ))}>
                            <option value="">—</option>
                            {KIBT_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5">
                          <span className={`text-xs font-medium ${row.consent === "Yes" ? "text-green-600" : "text-gray-400"}`}>
                            {row.consent ?? "No"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {mappedRows.length > 100 && (
                  <p className="text-xs text-gray-400 text-center py-2">
                    Showing first 100 of {mappedRows.length} rows — all will be imported.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: Done ───────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="card p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} className="text-green-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Import Complete!</h2>
            <p className="text-gray-500 text-sm">
              <strong>{savedCount}</strong> participant{savedCount !== 1 ? "s" : ""} successfully imported.
            </p>
            <div className="flex gap-3 justify-center mt-6">
              <button className="btn-secondary" onClick={reset}>
                <Plus size={14} /> Import Another File
              </button>
              <a href="/participants" className="btn-primary">
                View Participants →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
