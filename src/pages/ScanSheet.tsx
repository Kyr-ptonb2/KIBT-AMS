import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  Upload, ScanLine, Plus, Save, CheckCircle,
  AlertCircle, Loader, FileImage, X
} from "lucide-react";
import { useStore } from "../store";
import {
  getEvents, scanSheet, scanBatch, saveParticipants
} from "../hooks/useTauri";
import {
  ParticipantInput, BatchProgressEvent, QueueItem,
  BUSINESS_TYPES, SCAN_METHOD_LABELS
} from "../types";
import PageHeader from "../components/PageHeader";

type ScanMode = "single" | "batch";

export default function ScanSheet() {
  const { selectedFY, isOnline, addToast } = useStore();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const { data: events } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
  });

  const [mode, setMode] = useState<ScanMode>("single");
  const [selectedEventId, setSelectedEventId] = useState<string>(searchParams.get("event") ?? "");
  const [selectedSessionId, setSelectedSessionId] = useState<string>(searchParams.get("session") ?? "");

  // Single scan state
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [singlePreview, setSinglePreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [singleMethod, setSingleMethod] = useState<string | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [reviewRows, setReviewRows] = useState<ParticipantInput[]>([]);
  const [saving, setSaving] = useState(false);

  // Batch state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchRows, setBatchRows] = useState<{ filename: string; rows: ParticipantInput[] }[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);

  // Listen for batch progress events from Rust
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<BatchProgressEvent>("scan_batch_progress", (event) => {
      const p = event.payload;
      setQueue((prev) =>
        prev.map((item) =>
          item.itemId === p.itemId
            ? {
                ...item,
                status: p.status === "processing" ? "processing"
                       : p.status === "done"       ? "done"
                       : "failed",
                method: p.method,
                extractedCount: p.extractedCount,
                error: p.error,
              }
            : item
        )
      );
    }).then((fn) => { unlistenFn = fn; });

    return () => { unlistenFn?.(); };
  }, []);

  // ── Single scan handlers ──────────────────────────────────────────────────

  const handleSingleFile = (file: File) => {
    setSingleFile(file);
    const objectUrl = URL.createObjectURL(file);
    setSinglePreview(objectUrl);
    setReviewRows([]);
    setSingleMethod(null);
  };

  // Cleanup preview URLs when they change
  useEffect(() => {
    return () => {
      if (singlePreview) URL.revokeObjectURL(singlePreview);
    };
  }, [singlePreview]);

  // Cleanup batch preview URLs on unmount and queue changes
  useEffect(() => {
    return () => {
      queue.forEach((item: any) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [queue]);

  const handleSingleScan = async () => {
    if (!singleFile || !selectedEventId) return;
    setScanning(true);
    try {
      const bytes = Array.from(new Uint8Array(await singleFile.arrayBuffer()));
      const result = await scanSheet(selectedEventId, bytes, singleFile.name);
      setReviewRows(result.rows.length > 0 ? result.rows : [emptyRow()]);
      setSingleMethod(result.method);
      setDetectedColumns(result.detectedColumns ?? []);
      if (result.accuracyNote) addToast({ type: "warning", message: result.accuracyNote });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setScanning(false);
    }
  };

  const handleSingleSave = async () => {
    if (!selectedEventId || reviewRows.length === 0) return;
    setSaving(true);
    try {
      const count = await saveParticipants(selectedEventId, reviewRows.filter((r) => r.name.trim()));
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      addToast({ type: "success", message: `${count} participant${count === 1 ? "" : "s"} saved.` });
      setReviewRows([]);
      setSingleFile(null);
      setSinglePreview(null);
      setSingleMethod(null);
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  // ── Batch handlers ────────────────────────────────────────────────────────

  const handleBatchFiles = (files: FileList) => {
    const newItems: QueueItem[] = Array.from(files).map((file) => ({
      itemId: crypto.randomUUID(),
      eventId: selectedEventId,
      imageBytes: [],
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "waiting",
      _file: file,
    } as any));
    setQueue((prev) => [...prev, ...newItems]);
  };

  const handleBatchRun = async () => {
    if (queue.length === 0 || !selectedEventId) return;
    setBatchRunning(true);
    setBatchRows([]);

    // Load all file bytes
    const items = await Promise.all(
      queue.map(async (item: any) => ({
        itemId: item.itemId,
        eventId: item.eventId || selectedEventId,
        imageBytes: Array.from(new Uint8Array(await item._file.arrayBuffer())),
        filename: item.filename,
      }))
    );

    try {
      const result = await scanBatch(items);
      const combined = result.results.map((r) => ({
        filename: r.filename,
        rows: r.rows,
      }));
      setBatchRows(combined);
      // Update queue statuses
      setQueue((prev) =>
        prev.map((item) => {
          const r = result.results.find((x) => x.itemId === item.itemId);
          return r ? { ...item, status: r.status as any, method: r.method, extractedCount: r.rows.length, error: r.error } : item;
        })
      );
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setBatchRunning(false);
    }
  };

  const handleBatchSave = async () => {
    if (!selectedEventId) return;
    setBatchSaving(true);
    try {
      let total = 0;
      for (const group of batchRows) {
        const count = await saveParticipants(selectedEventId, group.rows.filter((r) => r.name.trim()));
        total += count;
      }
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      addToast({ type: "success", message: `${total} participants saved from ${batchRows.length} sheets.` });
      setQueue([]);
      setBatchRows([]);
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setBatchSaving(false);
    }
  };

  const addManualRow = () => setReviewRows((prev) => [...prev, emptyRow()]);
  const updateRow = (i: number, field: keyof ParticipantInput, value: string) => {
    setReviewRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };
  const removeRow = (i: number) => setReviewRows((prev) => prev.filter((_, idx) => idx !== i));

  const scanMethodBadge = (method: string | null) => {
    if (!method) return null;
    const m = SCAN_METHOD_LABELS[method] ?? SCAN_METHOD_LABELS.manual;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${m.bg} ${m.color}`}>
        {method === "gemini" ? <CheckCircle size={12} /> : method === "tesseract" ? <AlertCircle size={12} /> : null}
        {m.label}
      </span>
    );
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Scan Attendance Sheet"
        subtitle="Upload a photograph of a completed KIBT attendance register"
      />

      <div className="px-8 py-6 space-y-5">
        {/* ── Event selector + mode toggle ─────────────────────────── */}
        <div className="card p-5 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-48">
            <label className="label">Select Event *</label>
            <select
              className="select"
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
            >
              <option value="">— Choose an event —</option>
              {events?.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.region} · {ev.startDate} · {ev.title}
                </option>
              ))}
            </select>
          </div>
          {/* Session selector */}
          {selectedEventId && (
            <SessionSelector
              eventId={selectedEventId}
              value={selectedSessionId}
              onChange={setSelectedSessionId}
            />
          )}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(["single", "batch"] as ScanMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-kibt-green text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {m === "single" ? "Single Image" : "Batch Upload"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Scan method:</span>
            {scanMethodBadge(isOnline ? "gemini" : "tesseract")}
          </div>
        </div>

        {/* ══ SINGLE MODE ══════════════════════════════════════════════ */}
        {mode === "single" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Upload area */}
              <div
                className={`card p-0 overflow-hidden border-2 border-dashed cursor-pointer transition-colors ${
                  singlePreview ? "border-kibt-green/30" : "border-gray-200 hover:border-kibt-green/40"
                }`}
                onClick={() => !singlePreview && fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleSingleFile(file);
                }}
              >
                {singlePreview ? (
                  <div className="relative">
                    <img src={singlePreview} alt="Preview" className="w-full max-h-80 object-contain bg-gray-100" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setSingleFile(null); setSinglePreview(null); setReviewRows([]); setSingleMethod(null); }}
                      className="absolute top-2 right-2 bg-white rounded-full p-1 shadow text-gray-500 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                    <div className="px-4 py-3 text-xs text-gray-500 bg-white border-t border-gray-100 flex items-center gap-2">
                      <FileImage size={13} /> {singleFile?.name}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                    <Upload size={32} className="mb-3 text-gray-300" />
                    <p className="text-sm font-medium text-gray-600">Drop image here or click to browse</p>
                    <p className="text-xs mt-1">JPEG, PNG, or TIFF · max 20 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/tiff,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSingleFile(f); }}
              />

              {/* Tips */}
              <div className="card p-5 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Photo Tips</h3>
                <TipRow text="Photograph directly overhead — avoid shooting at an angle" />
                <TipRow text="Avoid direct flash on glossy paper — natural or overhead light works best" />
                <TipRow text="Minimum 1200×900 pixels — any modern phone camera works" />
                <TipRow text="Each physical page = one image file" />
                <TipRow text="Portrait orientation preferred" />
                <div className="pt-2 border-t border-gray-100">
                  <button
                    className="btn-primary w-full justify-center"
                    disabled={!singleFile || !selectedEventId || scanning}
                    onClick={handleSingleScan}
                  >
                    {scanning ? (
                      <><Loader size={15} className="animate-spin" /> Extracting…</>
                    ) : (
                      <><ScanLine size={15} /> Extract Data</>
                    )}
                  </button>
                  {!selectedEventId && (
                    <p className="text-xs text-amber-600 mt-2 text-center">Select an event above first</p>
                  )}
                </div>
              </div>
            </div>

            {/* Review table */}
            {(reviewRows.length > 0 || singleMethod) && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-800">
                      Review — {reviewRows.filter((r) => r.name.trim()).length} rows
                    </h3>
                    {scanMethodBadge(singleMethod)}
                    {singleMethod === "tesseract" && (
                      <span className="text-xs text-amber-600">Review names and phone numbers carefully</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs" onClick={addManualRow}>
                      <Plus size={13} /> Add Row
                    </button>
                    <button
                      className="btn-primary text-xs"
                      onClick={handleSingleSave}
                      disabled={saving || reviewRows.filter((r) => r.name.trim()).length === 0}
                    >
                      {saving ? <><Loader size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save All</>}
                    </button>
                  </div>
                </div>
                <ReviewTable rows={reviewRows} onUpdate={updateRow} onRemove={removeRow} detectedColumns={detectedColumns} />
              </div>
            )}

            {/* Manual entry fallback */}
            {reviewRows.length === 0 && !scanning && (
              <div className="text-center py-2">
                <button
                  className="text-xs text-kibt-green hover:underline"
                  onClick={() => { setReviewRows([emptyRow()]); setSingleMethod("manual"); }}
                >
                  Skip scan — enter manually
                </button>
              </div>
            )}
          </>
        )}

        {/* ══ BATCH MODE ══════════════════════════════════════════════ */}
        {mode === "batch" && (
          <>
            {/* Drop zone */}
            <div
              className="card border-2 border-dashed border-gray-200 hover:border-kibt-green/40 cursor-pointer transition-colors p-10 text-center"
              onClick={() => batchInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) handleBatchFiles(e.dataTransfer.files); }}
            >
              <Upload size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-medium text-gray-600">Click to add images or drag & drop</p>
              <p className="text-xs text-gray-400 mt-1">Select multiple files with Ctrl+click · JPEG, PNG, TIFF</p>
            </div>
            <input
              ref={batchInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/png,image/tiff,image/webp"
              className="hidden"
              onChange={(e) => { if (e.target.files) handleBatchFiles(e.target.files); }}
            />

            {/* Queue panel */}
            {queue.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-800">{queue.length} image{queue.length !== 1 ? "s" : ""} in queue</h3>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => setQueue([])}
                      disabled={batchRunning}
                    >
                      Clear All
                    </button>
                    <button
                      className="btn-primary text-xs"
                      onClick={handleBatchRun}
                      disabled={batchRunning || !selectedEventId}
                    >
                      {batchRunning ? <><Loader size={13} className="animate-spin" /> Processing…</> : <><ScanLine size={13} /> Start Batch</>}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {queue.map((item, i) => (
                    <QueueRow
                      key={item.itemId}
                      item={item}
                      index={i}
                      onRemove={() => setQueue((prev) => prev.filter((x) => x.itemId !== item.itemId))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Combined review table */}
            {batchRows.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-800">
                    Review — {batchRows.reduce((s, g) => s + g.rows.length, 0)} rows from {batchRows.length} sheets
                  </h3>
                  <button
                    className="btn-primary text-xs"
                    onClick={handleBatchSave}
                    disabled={batchSaving}
                  >
                    {batchSaving ? <><Loader size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save All</>}
                  </button>
                </div>
                {batchRows.map((group, gi) => (
                  <div key={gi} className="mb-6">
                    <div className="flex items-center gap-2 mb-2 py-1 px-3 bg-gray-50 rounded-lg text-xs text-gray-500 font-medium">
                      <FileImage size={12} /> {group.filename} — {group.rows.length} rows
                    </div>
                    <ReviewTable
                      rows={group.rows}
                      onUpdate={(i, field, val) =>
                        setBatchRows((prev) =>
                          prev.map((g, gx) =>
                            gx === gi
                              ? { ...g, rows: g.rows.map((r, rx) => rx === i ? { ...r, [field]: val } : r) }
                              : g
                          )
                        )
                      }
                      onRemove={(i) =>
                        setBatchRows((prev) =>
                          prev.map((g, gx) =>
                            gx === gi ? { ...g, rows: g.rows.filter((_, rx) => rx !== i) } : g
                          )
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TipRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-gray-500">
      <CheckCircle size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
      {text}
    </div>
  );
}

function QueueRow({ item, index, onRemove }: { item: QueueItem; index: number; onRemove: () => void }) {
  const statusIcon = {
    waiting:    <div className="w-2 h-2 rounded-full bg-gray-300" />,
    processing: <Loader size={12} className="animate-spin text-blue-500" />,
    done:       <CheckCircle size={14} className="text-green-500" />,
    failed:     <AlertCircle size={14} className="text-red-500" />,
  }[item.status];

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50">
      <img src={item.previewUrl} alt="" className="w-10 h-10 object-cover rounded" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-700 truncate">{item.filename}</p>
        <p className="text-xs text-gray-400">
          #{index + 1}
          {item.extractedCount != null && ` · ${item.extractedCount} rows extracted`}
          {item.error && ` · ${item.error}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {item.method && <span className={`text-xs px-2 py-0.5 rounded-full ${SCAN_METHOD_LABELS[item.method]?.bg} ${SCAN_METHOD_LABELS[item.method]?.color}`}>{SCAN_METHOD_LABELS[item.method]?.label}</span>}
        {statusIcon}
        {item.status === "waiting" && (
          <button onClick={onRemove} className="text-gray-300 hover:text-red-400 p-1">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewTable({
  rows,
  onUpdate,
  onRemove,
  detectedColumns = [],
}: {
  rows: ParticipantInput[];
  onUpdate: (i: number, field: keyof ParticipantInput, value: string) => void;
  onRemove: (i: number) => void;
  detectedColumns?: string[];
}) {
  // Show location column if any row has a location OR if Gemini detected it
  const hasLocation = rows.some(r => r.location) ||
    detectedColumns.some(c => /location|area|sub.?location/i.test(c));
  // Show consent column if any row has consent OR Gemini detected it
  const hasConsent = rows.some(r => r.consent != null) ||
    detectedColumns.some(c => /consent|sign/i.test(c));

  return (
    <div className="overflow-x-auto">
      {detectedColumns.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="text-xs text-gray-400">Columns detected:</span>
          {detectedColumns.map(c => (
            <span key={c} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{c}</span>
          ))}
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-100">
            <th className="pb-2 pr-2 font-medium w-5">#</th>
            <th className="pb-2 pr-2 font-medium min-w-40">Full Name *</th>
            <th className="pb-2 pr-2 font-medium min-w-36">Business Type</th>
            <th className="pb-2 pr-2 font-medium w-16">Age</th>
            <th className="pb-2 pr-2 font-medium w-16">Gender</th>
            <th className="pb-2 pr-2 font-medium min-w-28">Phone</th>
            {hasLocation && <th className="pb-2 pr-2 font-medium min-w-28">Location</th>}
            {hasConsent  && <th className="pb-2 pr-2 font-medium w-16">Consent</th>}
            <th className="pb-2 font-medium w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, i) => (
            <tr key={i} className={`hover:bg-gray-50 ${!row.name.trim() ? "opacity-50" : ""}`}>
              <td className="py-1.5 pr-2 text-gray-400">{i + 1}</td>
              <td className="py-1.5 pr-2">
                <input className="table-cell-edit font-medium" value={row.name}
                  onChange={(e) => onUpdate(i, "name", e.target.value)} placeholder="Full name" />
              </td>
              <td className="py-1.5 pr-2">
                <select className="table-cell-edit" value={row.businessType ?? ""}
                  onChange={(e) => onUpdate(i, "businessType", e.target.value)}>
                  <option value="">—</option>
                  {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <select className="table-cell-edit" value={row.ageCategory ?? ""}
                  onChange={(e) => onUpdate(i, "ageCategory", e.target.value)}>
                  <option value="">—</option>
                  <option value="A">A (35+)</option>
                  <option value="B">B (&lt;35)</option>
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <select className="table-cell-edit" value={row.gender ?? ""}
                  onChange={(e) => onUpdate(i, "gender", e.target.value)}>
                  <option value="">—</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <input className="table-cell-edit" value={row.phone ?? ""}
                  onChange={(e) => onUpdate(i, "phone", e.target.value)} placeholder="07xx xxx xxx" />
              </td>
              {hasLocation && (
                <td className="py-1.5 pr-2">
                  <input className="table-cell-edit" value={row.location ?? ""}
                    onChange={(e) => onUpdate(i, "location", e.target.value)} placeholder="Location" />
                </td>
              )}
              {hasConsent && (
                <td className="py-1.5 pr-2">
                  <select className="table-cell-edit" value={row.consent ?? "No"}
                    onChange={(e) => onUpdate(i, "consent", e.target.value)}>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </select>
                </td>
              )}
              <td className="py-1.5">
                <button onClick={() => onRemove(i)} className="text-gray-300 hover:text-red-400 p-1">
                  <X size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function emptyRow(): ParticipantInput {
  return { name: "", businessType: "", ageCategory: "", gender: "", phone: "", consent: "No" };
}

function SessionSelector({ eventId, value, onChange }: {
  eventId: string; value: string; onChange: (v: string) => void;
}) {
  const { data: sessions } = useQuery({
    queryKey: ["sessions", eventId],
    queryFn: () => import("../hooks/useTauri").then(m => m.getEventSessions(eventId)),
    enabled: !!eventId,
  });
  if (!sessions || sessions.length === 0) return null;
  return (
    <div className="min-w-52">
      <label className="label">Session (optional)</label>
      <select className="select text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— All sessions —</option>
        {sessions.map((s: any) => (
          <option key={s.id} value={s.id}>
            Session {s.sessionNo}{s.title ? ` — ${s.title}` : ""} ({s.date})
          </option>
        ))}
      </select>
    </div>
  );
}
