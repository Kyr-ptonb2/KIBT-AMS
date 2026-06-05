// ImportParticipants.tsx — Upload CSV/Excel, map columns, check duplicates, import.

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  Upload, FileSpreadsheet, FileText, CheckCircle,
  AlertTriangle, X, Save, Plus, Loader, Info, Download, AlertCircle
} from "lucide-react";
import { useStore } from "../store";
import { getEvents, getEventSessions, importParticipants, checkDuplicates } from "../hooks/useTauri";
import { BUSINESS_TYPES, KIBT_REGIONS, ParticipantInput, DuplicateCheckResult } from "../types";
import PageHeader from "../components/PageHeader";

// ── Column mapping helpers ─────────────────────────────────────────────────────

const COL_ALIASES: Record<string, keyof ParticipantInput> = {
  "name": "name", "full name": "name", "participant name": "name",
  "participants' full name": "name", "participants full name": "name",
  "full_name": "name", "participant": "name",
  "business type": "businessType", "type of business": "businessType",
  "business": "businessType", "business_type": "businessType",
  "age": "ageCategory", "age category": "ageCategory",
  "a=above 35 yrs or b=below 35 yrs": "ageCategory", "age_category": "ageCategory",
  "gender": "gender", "gender m\\f": "gender", "sex": "gender",
  "m/f": "gender", "gender (m/f)": "gender",
  "phone": "phone", "phone number": "phone", "telephone": "phone",
  "telephone no.": "phone", "mobile": "phone", "contact": "phone",
  "phone_number": "phone", "tel": "phone",
  "location": "location", "sub-location": "location", "area": "location",
  "sub location": "location", "sublocation": "location",
  "region": "region", "county": "region", "zone": "region",
  "consent": "consent", "sign if you consent": "consent",
  "sign": "consent", "signature": "consent",
  "id number": "idNumber", "national id": "idNumber", "id no": "idNumber",
  "id_number": "idNumber", "national id number": "idNumber", "passport": "idNumber",
  "id": "idNumber",
};

function detectField(header: string): keyof ParticipantInput | null {
  return COL_ALIASES[header.toLowerCase().trim()] ?? null;
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
    default: return v;
  }
}

type MappedRow = ParticipantInput & { _rowIndex: number; _valid: boolean; _skip: boolean };
type Step = "upload" | "map" | "review" | "done";

const MATCH_LABEL: Record<string, string> = {
  phone:      "same phone",
  id_number:  "same ID number",
  name_phone: "same name + phone",
};

export default function ImportParticipants() {
  const { selectedFY, addToast } = useStore();
  const qc = useQueryClient();

  const [selectedEventId, setSelectedEventId]   = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [file, setFile]             = useState<File | null>(null);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows]       = useState<Record<string, string>[]>([]);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [colMap, setColMap]         = useState<Record<string, keyof ParticipantInput | "skip">>({});
  const [step, setStep]             = useState<Step>("upload");
  const [saving, setSaving]         = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [duplicates, setDuplicates] = useState<DuplicateCheckResult[]>([]);
  const [checkingDups, setCheckingDups] = useState(false);
  const [showDupDetails, setShowDupDetails] = useState<number | null>(null);
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
        // Fix: use transform instead of deprecated trimHeaders
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h: string) => h.trim(),
        });
        processData(result.meta?.fields ?? [], result.data);
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
        if (json.length > 0) processData(Object.keys(json[0]), json);
      };
      reader.readAsArrayBuffer(f);
    }
  }, []);

  function processData(headers: string[], rows: Record<string, string>[]) {
    setRawHeaders(headers);
    setRawRows(rows);
    const autoMap: Record<string, keyof ParticipantInput | "skip"> = {};
    headers.forEach(h => { autoMap[h] = detectField(h) ?? "skip"; });
    setColMap(autoMap);
    setStep("map");
  }

  function applyMapping() {
    const rows: MappedRow[] = rawRows.map((raw, idx) => {
      const row: Partial<ParticipantInput> = {};
      Object.entries(colMap).forEach(([header, field]) => {
        if (field === "skip") return;
        const val = normaliseValue(field, raw[header] ?? "");
        if (val) (row as any)[field] = val;
      });
      const valid = !!(row.name?.trim());
      return { ...row, name: row.name ?? "", _rowIndex: idx + 2, _valid: valid, _skip: false };
    }).filter(r => r.name.trim() !== "");

    setMappedRows(rows);
    runDuplicateCheck(rows);
  }

  async function runDuplicateCheck(rows: MappedRow[]) {
    setCheckingDups(true);
    setStep("review");
    try {
      const payload = rows.filter(r => r._valid).map(({ _rowIndex, _valid, _skip, ...r }) => r);
      const dups = await checkDuplicates(payload);
      setDuplicates(dups);
    } catch {
      // duplicate check is non-blocking — failures are silent
    } finally {
      setCheckingDups(false);
    }
  }

  const dupIndexSet = new Set(duplicates.map(d => d.inputIndex));

  const handleSave = async () => {
    const validRows = mappedRows.filter(r => r._valid && !r._skip);
    if (!selectedEventId || validRows.length === 0) return;
    setSaving(true);
    try {
      const payload = validRows.map(({ _rowIndex, _valid, _skip, ...r }) => r);
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

  const reset = () => {
    setFile(null); setRawHeaders([]); setRawRows([]);
    setMappedRows([]); setColMap({}); setStep("upload");
    setSavedCount(0); setDuplicates([]); setShowDupDetails(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const fieldOptions: Array<{ value: keyof ParticipantInput | "skip"; label: string }> = [
    { value: "skip",         label: "— Skip this column —" },
    { value: "name",         label: "Full Name" },
    { value: "businessType", label: "Business Type" },
    { value: "ageCategory",  label: "Age Category (A/B)" },
    { value: "gender",       label: "Gender (M/F)" },
    { value: "phone",        label: "Phone Number" },
    { value: "idNumber",     label: "National ID / Passport" },
    { value: "location",     label: "Location/Sub-location" },
    { value: "region",       label: "Region/County" },
    { value: "consent",      label: "Consent" },
  ];

  const validCount = mappedRows.filter(r => r._valid && !r._skip).length;
  const dupCount   = duplicates.length;

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Import Participants"
        subtitle="Upload CSV, Excel (.xlsx), or Google Sheets export"
        actions={step !== "upload" && (
          <button className="btn-secondary text-xs" onClick={reset}>
            <X size={13} /> Start Over
          </button>
        )}
      />

      <div className="px-8 py-6 space-y-5 max-w-5xl">
        {/* Progress */}
        <div className="flex items-center gap-2">
          {(["upload","map","review","done"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s ? "bg-kibt-green text-white"
                : (["upload","map","review","done"] as Step[]).indexOf(step) > i ? "bg-green-200 text-green-700"
                : "bg-gray-200 text-gray-400"
              }`}>{i + 1}</div>
              <span className={`text-xs font-medium capitalize ${step === s ? "text-gray-800" : "text-gray-400"}`}>
                {s === "upload" ? "Upload File" : s === "map" ? "Map Columns" : s === "review" ? "Review" : "Done"}
              </span>
              {i < 3 && <div className="w-6 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* ── STEP 1: Upload ──────────────────────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-5">
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

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">Accepted formats</p>
              <div className="grid grid-cols-3 gap-3 text-xs text-blue-700">
                <div className="flex items-start gap-2">
                  <FileSpreadsheet size={14} className="mt-0.5 flex-shrink-0" />
                  <span><strong>.xlsx / .xls</strong><br/>Microsoft Excel or Google Sheets download</span>
                </div>
                <div className="flex items-start gap-2">
                  <FileText size={14} className="mt-0.5 flex-shrink-0" />
                  <span><strong>.csv</strong><br/>Google Forms export or any CSV source</span>
                </div>
                <div className="flex items-start gap-2">
                  <Info size={14} className="mt-0.5 flex-shrink-0" />
                  <span><strong>Column headers</strong><br/>First row must contain column names.
                    <a href="/import-template.csv" download className="underline text-blue-600 flex items-center gap-1 mt-1">
                      <Download size={11} /> Download template CSV
                    </a>
                  </span>
                </div>
              </div>
            </div>

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

        {/* ── STEP 2: Map columns ─────────────────────────────────────────── */}
        {step === "map" && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Map Your Columns</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {rawRows.length} rows in <strong>{file?.name}</strong>. Adjust any auto-detected mappings.
                </p>
              </div>
              <button className="btn-primary text-xs" onClick={applyMapping}
                disabled={!Object.values(colMap).includes("name")}>
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
                      <td className="py-2 pr-4 text-xs text-gray-500 max-w-48 truncate">{rawRows[0]?.[h] ?? "—"}</td>
                      <td className="py-2">
                        <select
                          className={`select text-xs py-1 ${colMap[h] !== "skip" ? "border-kibt-green/40 bg-green-50" : ""}`}
                          value={colMap[h] ?? "skip"}
                          onChange={e => setColMap(p => ({ ...p, [h]: e.target.value as any }))}
                        >
                          {fieldOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!Object.values(colMap).includes("name") && (
              <div className="mt-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle size={13} /> Map at least one column to <strong>Full Name</strong> before continuing.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Review ──────────────────────────────────────────────── */}
        {step === "review" && (
          <div className="space-y-4">

            {/* Duplicate warning banner */}
            {checkingDups && (
              <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-xl px-4 py-3">
                <Loader size={13} className="animate-spin" /> Checking for duplicates…
              </div>
            )}

            {!checkingDups && dupCount > 0 && (
              <div className="card border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-amber-800">
                    {dupCount} possible duplicate{dupCount > 1 ? "s" : ""} detected
                  </span>
                  <span className="text-xs text-amber-600 ml-1">
                    — rows flagged below. Uncheck to skip importing them.
                  </span>
                </div>
                <div className="space-y-2">
                  {duplicates.map((dup) => (
                    <div key={dup.inputIndex} className="bg-white rounded-lg border border-amber-100 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-gray-800">
                            Row {dup.inputIndex + 1}: <span className="text-amber-700">{dup.inputName}</span>
                            {dup.inputPhone && <span className="text-gray-500 ml-2 font-normal">{dup.inputPhone}</span>}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Matched {dup.matches.length} existing record{dup.matches.length > 1 ? "s" : ""} by{" "}
                            <strong>{[...new Set(dup.matches.map(m => MATCH_LABEL[m.matchOn]))].join(", ")}</strong>
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <button
                            className="text-xs text-blue-600 underline"
                            onClick={() => setShowDupDetails(showDupDetails === dup.inputIndex ? null : dup.inputIndex)}
                          >
                            {showDupDetails === dup.inputIndex ? "Hide" : "Show"} matches
                          </button>
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox"
                              checked={!mappedRows[dup.inputIndex]?._skip}
                              onChange={e => setMappedRows(prev => prev.map((r, i) =>
                                i === dup.inputIndex ? { ...r, _skip: !e.target.checked } : r
                              ))}
                            />
                            Import anyway
                          </label>
                        </div>
                      </div>
                      {showDupDetails === dup.inputIndex && (
                        <div className="mt-2 space-y-1.5">
                          {dup.matches.map(m => (
                            <div key={m.participantId} className="flex items-center gap-3 text-xs text-gray-600 bg-gray-50 rounded px-2.5 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                m.matchOn === "phone" ? "bg-orange-100 text-orange-700" :
                                m.matchOn === "id_number" ? "bg-red-100 text-red-700" :
                                "bg-yellow-100 text-yellow-700"
                              }`}>{MATCH_LABEL[m.matchOn]}</span>
                              <span className="font-medium">{m.name}</span>
                              {m.phone && <span className="font-mono">{m.phone}</span>}
                              <span className="text-gray-400">·</span>
                              <span>{m.eventTitle}</span>
                              <span className="text-gray-400">·</span>
                              <span>{m.region}</span>
                              <span className="text-gray-400">·</span>
                              <span>{m.eventDate?.slice(0, 10)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!checkingDups && dupCount === 0 && mappedRows.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-xl px-4 py-3">
                <CheckCircle size={13} /> No duplicates found — all {mappedRows.filter(r=>r._valid).length} rows are new.
              </div>
            )}

            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    {validCount} participant{validCount !== 1 ? "s" : ""} ready to import
                  </h3>
                  {mappedRows.some(r => !r._valid) && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      {mappedRows.filter(r => !r._valid).length} rows skipped (no name)
                    </p>
                  )}
                  {mappedRows.some(r => r._skip) && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      {mappedRows.filter(r => r._skip).length} duplicate rows unchecked
                    </p>
                  )}
                </div>
                <button
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={saving || validCount === 0}
                >
                  {saving
                    ? <><Loader size={14} className="animate-spin" /> Importing…</>
                    : <><Save size={14} /> Import {validCount} Participant{validCount !== 1 ? "s" : ""}</>
                  }
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-2 w-8"></th>
                      <th className="pb-2 pr-3 font-medium">#</th>
                      <th className="pb-2 pr-3 font-medium min-w-40">Full Name</th>
                      <th className="pb-2 pr-3 font-medium">Business Type</th>
                      <th className="pb-2 pr-3 font-medium w-12">Age</th>
                      <th className="pb-2 pr-3 font-medium w-12">Gender</th>
                      <th className="pb-2 pr-3 font-medium">Phone</th>
                      <th className="pb-2 pr-3 font-medium">ID Number</th>
                      <th className="pb-2 pr-3 font-medium">Location</th>
                      <th className="pb-2 font-medium w-14">Consent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {mappedRows.slice(0, 100).map((row, i) => {
                      const isDup = dupIndexSet.has(i);
                      return (
                        <tr key={i} className={`hover:bg-gray-50 ${!row._valid ? "opacity-40 line-through" : ""} ${row._skip ? "opacity-50" : ""}`}>
                          <td className="py-1.5 pr-2">
                            {isDup && !row._skip && (
                              <AlertCircle size={12} className="text-amber-500" title="Possible duplicate" />
                            )}
                            {row._skip && (
                              <X size={12} className="text-gray-400" title="Will be skipped" />
                            )}
                          </td>
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
                          <td className="py-1.5 pr-3 text-gray-600">{row.idNumber ?? "—"}</td>
                          <td className="py-1.5 pr-3 text-gray-600">{row.location ?? "—"}</td>
                          <td className="py-1.5">
                            <span className={`text-xs font-medium ${row.consent === "Yes" ? "text-green-600" : "text-gray-400"}`}>
                              {row.consent ?? "No"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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

        {/* ── STEP 4: Done ─────────────────────────────────────────────────── */}
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
              <a href="/participants" className="btn-primary">View Participants →</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
