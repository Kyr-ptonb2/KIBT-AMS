// CustomTables.tsx — Dynamic user-defined tables.
// Admins can create tables with custom columns, paste a quick list,
// view/edit rows, and export to Excel or CSV.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Plus, Table2, Trash2, Pencil, Download, ChevronRight,
  ArrowLeft, X, Save, Loader, List, FileSpreadsheet,
  FileText, Link, Unlink, Search, CheckCircle
} from "lucide-react";
import {
  getCustomTables, getCustomTable, getCustomTableRows,
  createCustomTable, updateCustomTable, deleteCustomTable,
  upsertCustomTableRows, updateCustomTableRow, deleteCustomTableRow,
  createFromList, exportCustomTableCsv, exportCustomTableExcel,
  getEvents,
} from "../hooks/useTauri";
import { ColumnDef, CustomTableDef, CustomTableRow } from "../types";
import { useStore } from "../store";
import PageHeader from "../components/PageHeader";

type View = "list" | "table" | "new-table" | "new-list";

const COL_TYPES = ["text", "number", "date", "boolean"] as const;

export default function CustomTables() {
  const { currentUser, selectedFY, addToast } = useStore();
  const qc = useQueryClient();
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const [view, setView]                 = useState<View>("list");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [search, setSearch]             = useState("");

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ["custom_tables"],
    queryFn: getCustomTables,
    staleTime: 30_000,
  });

  const filtered = tables.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleOpen = (id: string) => { setSelectedTableId(id); setView("table"); };
  const handleBack = () => { setSelectedTableId(null); setView("list"); };

  return (
    <div className="min-h-full bg-gray-50">
      {view === "list" && (
        <>
          <PageHeader
            title="Custom Tables"
            subtitle="Create and manage your own data tables"
            actions={isAdmin && (
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => setView("new-list")}>
                  <List size={13} /> Quick List
                </button>
                <button className="btn-primary text-xs" onClick={() => setView("new-table")}>
                  <Plus size={13} /> New Table
                </button>
              </div>
            )}
          />
          <div className="px-8 py-6 space-y-4 max-w-4xl">
            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-8" placeholder="Search tables…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
                <Loader size={16} className="animate-spin" /> Loading…
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="card p-12 text-center">
                <Table2 size={36} className="mx-auto text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">No custom tables yet</p>
                {isAdmin && (
                  <p className="text-xs text-gray-400 mt-1">
                    Use "New Table" to define columns, or "Quick List" to paste a list instantly.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              {filtered.map(table => (
                <TableCard
                  key={table.id}
                  table={table}
                  isAdmin={isAdmin}
                  onOpen={() => handleOpen(table.id)}
                  onDelete={async () => {
                    if (!confirm(`Delete table "${table.name}" and all its rows?`)) return;
                    await deleteCustomTable(table.id);
                    qc.invalidateQueries({ queryKey: ["custom_tables"] });
                    addToast({ type: "success", message: `"${table.name}" deleted.` });
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {view === "table" && selectedTableId && (
        <TableView
          tableId={selectedTableId}
          isAdmin={isAdmin}
          onBack={handleBack}
          selectedFY={selectedFY}
        />
      )}

      {view === "new-table" && (
        <NewTableForm
          selectedFY={selectedFY}
          onBack={() => setView("list")}
          onCreated={(id) => { qc.invalidateQueries({ queryKey: ["custom_tables"] }); setSelectedTableId(id); setView("table"); }}
        />
      )}

      {view === "new-list" && (
        <QuickListForm
          selectedFY={selectedFY}
          onBack={() => setView("list")}
          onCreated={(id) => { qc.invalidateQueries({ queryKey: ["custom_tables"] }); setSelectedTableId(id); setView("table"); }}
        />
      )}
    </div>
  );
}

// ── Table card in list view ───────────────────────────────────────────────────
function TableCard({ table, isAdmin, onOpen, onDelete }: {
  table: CustomTableDef; isAdmin: boolean;
  onOpen: () => void; onDelete: () => void;
}) {
  return (
    <div className="card p-4 flex items-center gap-4 hover:shadow-sm transition-shadow cursor-pointer"
      onClick={onOpen}>
      <div className="w-10 h-10 rounded-xl bg-kibt-green/10 flex items-center justify-center flex-shrink-0">
        <Table2 size={18} className="text-kibt-green" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-800 truncate">{table.name}</p>
          {table.eventTitle && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full flex-shrink-0">
              <Link size={9} /> {table.eventTitle}
            </span>
          )}
        </div>
        {table.description && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{table.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-gray-400">
            {table.columns.length} col{table.columns.length !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-400">
            {table.rowCount} row{table.rowCount !== 1 ? "s" : ""}
          </span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-400">by {table.createdBy}</span>
        </div>
      </div>
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {isAdmin && (
          <button className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
            onClick={onDelete}><Trash2 size={13} /></button>
        )}
        <ChevronRight size={16} className="text-gray-300" />
      </div>
    </div>
  );
}

// ── Table detail / row view ───────────────────────────────────────────────────
function TableView({ tableId, isAdmin, onBack, selectedFY }: {
  tableId: string; isAdmin: boolean; onBack: () => void; selectedFY: string;
}) {
  const { addToast } = useStore();
  const qc = useQueryClient();

  const { data: def, isLoading: defLoading } = useQuery({
    queryKey: ["custom_table", tableId],
    queryFn: () => getCustomTable(tableId),
  });

  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["custom_table_rows", tableId],
    queryFn: () => getCustomTableRows(tableId),
    staleTime: 10_000,
  });

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editData, setEditData]         = useState<Record<string, string>>({});
  const [showAddRows, setShowAddRows]   = useState(false);
  const [newRows, setNewRows]           = useState<Record<string, string>[]>([]);
  const [editMeta, setEditMeta]         = useState(false);
  const [metaName, setMetaName]         = useState("");
  const [metaDesc, setMetaDesc]         = useState("");
  const [metaEventId, setMetaEventId]   = useState<string>("");
  const [saving, setSaving]             = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
    staleTime: 60_000,
  });

  if (defLoading) return <div className="flex items-center justify-center h-64"><Loader size={20} className="animate-spin text-gray-300" /></div>;
  if (!def) return null;

  const startEditMeta = () => {
    setMetaName(def.name); setMetaDesc(def.description ?? ""); setMetaEventId(def.eventId ?? "");
    setEditMeta(true);
  };

  const saveMeta = async () => {
    await updateCustomTable(tableId, metaName, metaDesc || undefined, metaEventId || undefined);
    qc.invalidateQueries({ queryKey: ["custom_table", tableId] });
    qc.invalidateQueries({ queryKey: ["custom_tables"] });
    setEditMeta(false);
    addToast({ type: "success", message: "Table updated." });
  };

  const startEdit = (row: CustomTableRow) => {
    const d: Record<string, string> = {};
    def.columns.forEach(c => { d[c.name] = String(row.data[c.name] ?? ""); });
    setEditData(d); setEditingRowId(row.id);
  };

  const saveRowEdit = async () => {
    if (!editingRowId) return;
    setSaving(true);
    try {
      await updateCustomTableRow(editingRowId, editData);
      qc.invalidateQueries({ queryKey: ["custom_table_rows", tableId] });
      setEditingRowId(null);
    } catch (e: any) { addToast({ type: "error", message: String(e) }); }
    finally { setSaving(false); }
  };

  const deleteRow = async (rowId: string) => {
    await deleteCustomTableRow(rowId);
    qc.invalidateQueries({ queryKey: ["custom_table_rows", tableId] });
    qc.invalidateQueries({ queryKey: ["custom_table", tableId] });
    qc.invalidateQueries({ queryKey: ["custom_tables"] });
  };

  const initNewRows = () => {
    const blank: Record<string, string> = {};
    def.columns.forEach(c => { blank[c.name] = ""; });
    setNewRows([{ ...blank }]);
    setShowAddRows(true);
  };

  const addBlankRow = () => {
    const blank: Record<string, string> = {};
    def.columns.forEach(c => { blank[c.name] = ""; });
    setNewRows(prev => [...prev, { ...blank }]);
  };

  const saveNewRows = async () => {
    const valid = newRows.filter(r => Object.values(r).some(v => v.trim()));
    if (!valid.length) return;
    setSaving(true);
    try {
      await upsertCustomTableRows({ tableId, rows: valid });
      qc.invalidateQueries({ queryKey: ["custom_table_rows", tableId] });
      qc.invalidateQueries({ queryKey: ["custom_table", tableId] });
      qc.invalidateQueries({ queryKey: ["custom_tables"] });
      setShowAddRows(false); setNewRows([]);
      addToast({ type: "success", message: `${valid.length} row${valid.length > 1 ? "s" : ""} added.` });
    } catch (e: any) { addToast({ type: "error", message: String(e) }); }
    finally { setSaving(false); }
  };

  const handleExport = async (format: "excel" | "csv") => {
    const ext  = format === "excel" ? "xlsx" : "csv";
    const path = await save({
      defaultPath: `${def.name.replace(/\s+/g, "_")}.${ext}`,
      filters: [{ name: format === "excel" ? "Excel" : "CSV", extensions: [ext] }],
    });
    if (!path) return;
    try {
      if (format === "excel") await exportCustomTableExcel(tableId, path);
      else                    await exportCustomTableCsv(tableId, path);
      addToast({ type: "success", message: `Exported to ${path.split(/[\\\/]/).pop()}` });
    } catch (e: any) { addToast({ type: "error", message: String(e) }); }
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title={editMeta ? (
          <input className="input text-lg font-bold py-1 w-72"
            value={metaName} onChange={e => setMetaName(e.target.value)} />
        ) : def.name}
        subtitle={
          editMeta ? (
            <input className="input text-sm py-1 w-96"
              value={metaDesc} onChange={e => setMetaDesc(e.target.value)}
              placeholder="Description (optional)" />
          ) : (def.description ?? `${rows.length} rows · ${def.columns.length} columns`)
        }
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={onBack}>
              <ArrowLeft size={13} /> Back
            </button>
            {isAdmin && !editMeta && (
              <button className="btn-secondary text-xs" onClick={startEditMeta}>
                <Pencil size={13} /> Edit
              </button>
            )}
            {editMeta && (
              <>
                <button className="btn-secondary text-xs" onClick={() => setEditMeta(false)}>Cancel</button>
                <button className="btn-primary text-xs" onClick={saveMeta}><Save size={13} /> Save</button>
              </>
            )}
            <button className="btn-secondary text-xs" onClick={() => handleExport("excel")}>
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button className="btn-secondary text-xs" onClick={() => handleExport("csv")}>
              <FileText size={13} /> CSV
            </button>
            {isAdmin && !showAddRows && (
              <button className="btn-primary text-xs" onClick={initNewRows}>
                <Plus size={13} /> Add Rows
              </button>
            )}
          </div>
        }
      />

      <div className="px-8 py-4 max-w-6xl space-y-4">

        {/* Event link badge + editor */}
        {editMeta && (
          <div className="card p-4 flex items-center gap-4">
            <Link size={14} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1">
              <label className="label">Link to Event (optional)</label>
              <select className="select" value={metaEventId}
                onChange={e => setMetaEventId(e.target.value)}>
                <option value="">— No event —</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.startDate} · {ev.region} · {ev.title}
                  </option>
                ))}
              </select>
            </div>
            {metaEventId && (
              <button className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"
                onClick={() => setMetaEventId("")}>
                <Unlink size={12} /> Unlink
              </button>
            )}
          </div>
        )}

        {!editMeta && def.eventTitle && (
          <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-xl px-4 py-2.5">
            <Link size={12} /> Linked to event: <strong>{def.eventTitle}</strong>
          </div>
        )}

        {/* Add rows panel */}
        {showAddRows && (
          <div className="card p-5 space-y-3 border border-kibt-green/20">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Add New Rows</p>
              <button className="text-xs text-gray-400 hover:text-gray-600"
                onClick={() => { setShowAddRows(false); setNewRows([]); }}>
                <X size={13} />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    {def.columns.map(c => (
                      <th key={c.name} className="pb-2 pr-3 font-medium">
                        {c.name}
                        {c.required && <span className="text-red-400 ml-0.5">*</span>}
                      </th>
                    ))}
                    <th className="pb-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {newRows.map((row, i) => (
                    <tr key={i}>
                      {def.columns.map(c => (
                        <td key={c.name} className="py-1.5 pr-3">
                          <input
                            className="input text-xs py-1"
                            type={c.colType === "number" ? "number" : c.colType === "date" ? "date" : "text"}
                            value={row[c.name] ?? ""}
                            onChange={e => setNewRows(prev => prev.map((r, ri) =>
                              ri === i ? { ...r, [c.name]: e.target.value } : r
                            ))}
                          />
                        </td>
                      ))}
                      <td className="py-1.5">
                        <button className="p-1 text-gray-300 hover:text-red-400"
                          onClick={() => setNewRows(prev => prev.filter((_, ri) => ri !== i))}>
                          <X size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button className="text-xs text-kibt-green hover:underline" onClick={addBlankRow}>
                + Add another row
              </button>
              <button className="btn-primary text-xs" onClick={saveNewRows} disabled={saving}>
                {saving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                Save {newRows.length} row{newRows.length > 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}

        {/* Data table */}
        <div className="card overflow-hidden">
          {rowsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader size={18} className="animate-spin text-gray-300" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400">No rows yet.</p>
              {isAdmin && (
                <button className="btn-primary mt-3 text-xs" onClick={initNewRows}>
                  <Plus size={12} /> Add First Rows
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 w-10">#</th>
                    {def.columns.map(c => (
                      <th key={c.name} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">
                        {c.name}
                        <span className="ml-1 text-gray-300 font-normal text-xs">{c.colType}</span>
                      </th>
                    ))}
                    {isAdmin && <th className="px-3 py-2.5 w-16"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((row, idx) => (
                    <tr key={row.id} className={`hover:bg-gray-50/50 ${editingRowId === row.id ? "bg-green-50/50" : ""}`}>
                      <td className="px-3 py-2 text-xs text-gray-400">{idx + 1}</td>
                      {def.columns.map(c => (
                        <td key={c.name} className="px-3 py-2 text-xs text-gray-700">
                          {editingRowId === row.id ? (
                            <input
                              className="input text-xs py-1"
                              type={c.colType === "number" ? "number" : c.colType === "date" ? "date" : "text"}
                              value={editData[c.name] ?? ""}
                              onChange={e => setEditData(p => ({ ...p, [c.name]: e.target.value }))}
                            />
                          ) : (
                            String(row.data[c.name] ?? "—")
                          )}
                        </td>
                      ))}
                      {isAdmin && (
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {editingRowId === row.id ? (
                              <>
                                <button className="p-1.5 rounded text-kibt-green hover:bg-green-50"
                                  onClick={saveRowEdit} disabled={saving}>
                                  {saving ? <Loader size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                                </button>
                                <button className="p-1.5 rounded text-gray-400 hover:bg-gray-100"
                                  onClick={() => setEditingRowId(null)}>
                                  <X size={11} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button className="p-1.5 rounded text-gray-400 hover:text-kibt-green hover:bg-green-50"
                                  onClick={() => startEdit(row)}><Pencil size={11} /></button>
                                <button className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                                  onClick={() => deleteRow(row.id)}><Trash2 size={11} /></button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── New Table Form ────────────────────────────────────────────────────────────
function NewTableForm({ onBack, onCreated, selectedFY }: {
  onBack: () => void; onCreated: (id: string) => void; selectedFY: string;
}) {
  const { addToast } = useStore();
  const [name, setName]           = useState("");
  const [desc, setDesc]           = useState("");
  const [eventId, setEventId]     = useState("");
  const [columns, setColumns]     = useState<ColumnDef[]>([
    { name: "", colType: "text", required: false },
  ]);
  const [saving, setSaving]       = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
    staleTime: 60_000,
  });

  const addCol = () => setColumns(prev => [...prev, { name: "", colType: "text", required: false }]);
  const removeCol = (i: number) => setColumns(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!name.trim()) { addToast({ type: "error", message: "Table name is required." }); return; }
    const validCols = columns.filter(c => c.name.trim());
    if (!validCols.length) { addToast({ type: "error", message: "Add at least one column." }); return; }
    setSaving(true);
    try {
      const def = await createCustomTable({
        name, description: desc || undefined,
        columns: validCols, eventId: eventId || undefined,
      });
      onCreated(def.id);
    } catch (e: any) { addToast({ type: "error", message: String(e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader title="New Custom Table" subtitle="Define columns for your table"
        actions={<button className="btn-secondary text-xs" onClick={onBack}><ArrowLeft size={13} /> Back</button>} />
      <div className="px-8 py-6 max-w-2xl space-y-5">

        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">Table Info</h3>
          <div>
            <label className="label">Table Name *</label>
            <input className="input" placeholder="e.g. Nairobi Traders Training June 2025"
              value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input className="input" placeholder="What is this table for?"
              value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div>
            <label className="label">Link to Event (optional)</label>
            <select className="select" value={eventId} onChange={e => setEventId(e.target.value)}>
              <option value="">— No event —</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.startDate} · {ev.region} · {ev.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Columns</h3>
            <button className="text-xs text-kibt-green hover:underline" onClick={addCol}>
              + Add column
            </button>
          </div>

          <div className="space-y-2">
            {columns.map((col, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder={`Column ${i + 1} name`}
                  value={col.name}
                  onChange={e => setColumns(prev => prev.map((c, ci) => ci === i ? { ...c, name: e.target.value } : c))}
                />
                <select
                  className="select w-28 text-sm"
                  value={col.colType}
                  onChange={e => setColumns(prev => prev.map((c, ci) => ci === i ? { ...c, colType: e.target.value as ColumnDef["colType"] } : c))}
                >
                  {COL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                  <input type="checkbox" checked={col.required}
                    onChange={e => setColumns(prev => prev.map((c, ci) => ci === i ? { ...c, required: e.target.checked } : c))} />
                  Required
                </label>
                {columns.length > 1 && (
                  <button className="text-gray-300 hover:text-red-400 p-1" onClick={() => removeCol(i)}>
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 pt-1">
            Columns cannot be renamed after creation (to protect existing data).
            Add as many as you need now.
          </p>
        </div>

        <div className="flex gap-3">
          <button className="btn-secondary" onClick={onBack}>Cancel</button>
          <button className="btn-primary flex-1 justify-center" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader size={14} className="animate-spin" /> : <Table2 size={14} />}
            Create Table
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick List Form ───────────────────────────────────────────────────────────
function QuickListForm({ onBack, onCreated, selectedFY }: {
  onBack: () => void; onCreated: (id: string) => void; selectedFY: string;
}) {
  const { addToast } = useStore();
  const [name, setName]         = useState("");
  const [desc, setDesc]         = useState("");
  const [colName, setColName]   = useState("Item");
  const [eventId, setEventId]   = useState("");
  const [rawText, setRawText]   = useState("");
  const [saving, setSaving]     = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
    staleTime: 60_000,
  });

  // Live preview
  const preview = rawText.trim()
    ? (rawText.includes('\n')
        ? rawText.split('\n').map(l => l.trim()).filter(Boolean)
        : rawText.split(',').map(s => s.trim()).filter(Boolean)
      ).slice(0, 8)
    : [];

  const handleSubmit = async () => {
    if (!name.trim()) { addToast({ type: "error", message: "Table name is required." }); return; }
    if (!rawText.trim()) { addToast({ type: "error", message: "List is empty." }); return; }
    setSaving(true);
    try {
      const def = await createFromList({
        name, description: desc || undefined,
        eventId: eventId || undefined,
        rawText, columnName: colName || "Item",
      });
      onCreated(def.id);
    } catch (e: any) { addToast({ type: "error", message: String(e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader title="Quick List" subtitle="Paste a list — each item becomes a row"
        actions={<button className="btn-secondary text-xs" onClick={onBack}><ArrowLeft size={13} /> Back</button>} />
      <div className="px-8 py-6 max-w-2xl space-y-5">

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Accepted formats</p>
          <p>One item per line (pasted from Excel, Word, or typed) — <strong>or</strong> comma-separated on one line — <strong>or</strong> a JSON array like <code>["A","B","C"]</code></p>
        </div>

        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Table Name *</label>
              <input className="input" placeholder="e.g. Vendor List May 2025"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Column Name</label>
              <input className="input" placeholder="e.g. Name, Product, ID…"
                value={colName} onChange={e => setColName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input className="input" value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="What is this list?" />
          </div>
          <div>
            <label className="label">Link to Event (optional)</label>
            <select className="select" value={eventId} onChange={e => setEventId(e.target.value)}>
              <option value="">— No event —</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>
                  {ev.startDate} · {ev.region} · {ev.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Paste Your List *</label>
            <textarea
              className="input font-mono text-xs resize-y min-h-40"
              placeholder={"John Mwangi\nFatuma Hassan\nPeter Otieno\n…or paste comma-separated, or JSON array"}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
            />
          </div>

          {preview.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">
                Preview — {rawText.trim()
                  ? (rawText.includes('\n')
                    ? rawText.split('\n').filter(l => l.trim()).length
                    : rawText.split(',').filter(s => s.trim()).length)
                  : 0} items detected:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.map((item, i) => (
                  <span key={i} className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-xs">{item}</span>
                ))}
                {preview.length === 8 && <span className="px-2.5 py-1 text-gray-400 text-xs">…and more</span>}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button className="btn-secondary" onClick={onBack}>Cancel</button>
          <button className="btn-primary flex-1 justify-center" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader size={14} className="animate-spin" /> : <List size={14} />}
            Create List Table
          </button>
        </div>
      </div>
    </div>
  );
}
