// Export.tsx — Export attendance data with full filtering.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, FileSpreadsheet, FileText, Filter } from "lucide-react";
import { useStore } from "../store";
import { exportExcel, exportCsv, getEvents } from "../hooks/useTauri";
import { KIBT_REGIONS } from "../types";
import PageHeader from "../components/PageHeader";

export default function Export() {
  const { selectedFY, addToast } = useStore();
  const [filterFY,         setFilterFY]         = useState(selectedFY);
  const [filterRegion,     setFilterRegion]     = useState("");
  const [filterEventId,    setFilterEventId]    = useState("");
  const [filterGender,     setFilterGender]     = useState("");
  const [filterAgeCategory, setFilterAgeCategory] = useState("");
  const [filterConsent,    setFilterConsent]    = useState("");
  const [loading, setLoading] = useState<"excel" | "csv" | null>(null);

  const { data: events } = useQuery({
    queryKey: ["events", filterFY],
    queryFn: () => getEvents(filterFY),
    staleTime: 3 * 60_000,
  });

  // Active filter count (for badge)
  const activeFilters = [filterRegion, filterEventId, filterGender, filterAgeCategory, filterConsent]
    .filter(Boolean).length;

  const handleExport = async (format: "excel" | "csv") => {
    setLoading(format);
    try {
      const parts: string[] = [filterFY.replace("/", "-")];
      if (filterRegion)      parts.push(filterRegion.replace(/\s+/g, "_"));
      if (filterGender)      parts.push(filterGender);
      if (filterAgeCategory) parts.push(`Cat${filterAgeCategory}`);
      if (filterConsent)     parts.push(filterConsent === "Yes" ? "Consented" : "NoConsent");
      const defaultName = `KIBT_AMS_${parts.join("_")}.${format === "excel" ? "xlsx" : "csv"}`;

      const path = await save({
        defaultPath: defaultName,
        filters: format === "excel"
          ? [{ name: "Excel", extensions: ["xlsx"] }]
          : [{ name: "CSV",   extensions: ["csv"]  }],
      });
      if (!path) return;

      const filter = {
        financialYear: filterFY      || undefined,
        region:        filterRegion  || undefined,
        eventId:       filterEventId || undefined,
        gender:        filterGender  || undefined,
        ageCategory:   filterAgeCategory || undefined,
        consent:       filterConsent || undefined,
      };

      if (format === "excel") await exportExcel(filter, path);
      else                    await exportCsv(filter, path);

      addToast({ type: "success", message: `Exported to ${path.split(/[\\\/]/).pop()}` });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setLoading(null);
    }
  };

  const clearFilters = () => {
    setFilterRegion(""); setFilterEventId(""); setFilterGender("");
    setFilterAgeCategory(""); setFilterConsent("");
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Export Data"
        subtitle="Download attendance records as Excel or CSV"
      />

      <div className="px-8 py-6 max-w-2xl space-y-5">

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter size={15} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-800">Export Filters</h3>
              {activeFilters > 0 && (
                <span className="px-2 py-0.5 bg-kibt-green text-white text-xs rounded-full font-medium">
                  {activeFilters} active
                </span>
              )}
            </div>
            {activeFilters > 0 && (
              <button className="text-xs text-gray-400 hover:text-gray-600" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Financial Year */}
            <div>
              <label className="label">Financial Year</label>
              <input className="input" value={filterFY}
                onChange={e => { setFilterFY(e.target.value); setFilterEventId(""); }}
                placeholder="e.g. 2024/2025" />
            </div>

            {/* Region */}
            <div>
              <label className="label">Region</label>
              <select className="select" value={filterRegion}
                onChange={e => { setFilterRegion(e.target.value); setFilterEventId(""); }}>
                <option value="">All regions</option>
                {KIBT_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Specific Event */}
            <div className="col-span-2">
              <label className="label">Specific Event (optional)</label>
              <select className="select" value={filterEventId}
                onChange={e => setFilterEventId(e.target.value)}>
                <option value="">All events{filterRegion ? ` in ${filterRegion}` : ""}</option>
                {events
                  ?.filter(ev => !filterRegion || ev.region === filterRegion)
                  .map(ev => (
                    <option key={ev.id} value={ev.id}>
                      {ev.startDate} · {ev.region} · {ev.title}
                    </option>
                  ))}
              </select>
            </div>

            {/* Gender */}
            <div>
              <label className="label">Gender</label>
              <select className="select" value={filterGender}
                onChange={e => setFilterGender(e.target.value)}>
                <option value="">All genders</option>
                <option value="M">Male (M)</option>
                <option value="F">Female (F)</option>
              </select>
            </div>

            {/* Age Category */}
            <div>
              <label className="label">Age Category</label>
              <select className="select" value={filterAgeCategory}
                onChange={e => setFilterAgeCategory(e.target.value)}>
                <option value="">Both categories</option>
                <option value="A">Category A (Above 35)</option>
                <option value="B">Category B (Below 35)</option>
              </select>
            </div>

            {/* Consent */}
            <div>
              <label className="label">Consent Status</label>
              <select className="select" value={filterConsent}
                onChange={e => setFilterConsent(e.target.value)}>
                <option value="">All participants</option>
                <option value="Yes">Consented only</option>
                <option value="No">Not consented</option>
              </select>
            </div>
          </div>

          {/* Active filter summary */}
          {activeFilters > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {filterRegion     && <FilterBadge label={`Region: ${filterRegion}`}     onRemove={() => { setFilterRegion(""); setFilterEventId(""); }} />}
              {filterEventId    && <FilterBadge label={`Event: ${events?.find(e=>e.id===filterEventId)?.title ?? filterEventId}`} onRemove={() => setFilterEventId("")} />}
              {filterGender     && <FilterBadge label={`Gender: ${filterGender === "M" ? "Male" : "Female"}`} onRemove={() => setFilterGender("")} />}
              {filterAgeCategory && <FilterBadge label={`Age: Cat. ${filterAgeCategory}`} onRemove={() => setFilterAgeCategory("")} />}
              {filterConsent    && <FilterBadge label={`Consent: ${filterConsent}`}   onRemove={() => setFilterConsent("")} />}
            </div>
          )}
        </div>

        {/* ── Download buttons ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <FileSpreadsheet size={22} className="text-kibt-green" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Excel (.xlsx)</h3>
              <p className="text-xs text-gray-500 mt-0.5">Formatted spreadsheet — recommended for Ministry submission</p>
            </div>
            <button className="btn-primary w-full justify-center"
              onClick={() => handleExport("excel")} disabled={loading !== null}>
              {loading === "excel" ? "Exporting…" : <><Download size={14} /> Download Excel</>}
            </button>
          </div>

          <div className="card p-5 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <FileText size={22} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">CSV (.csv)</h3>
              <p className="text-xs text-gray-500 mt-0.5">Plain comma-separated values — for other systems</p>
            </div>
            <button className="btn-secondary w-full justify-center"
              onClick={() => handleExport("csv")} disabled={loading !== null}>
              {loading === "csv" ? "Exporting…" : <><Download size={14} /> Download CSV</>}
            </button>
          </div>
        </div>

        {/* ── Columns info ────────────────────────────────────────────────── */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Exported Columns</h3>
          <div className="flex flex-wrap gap-2">
            {["Event Title","Event Date","Region","Venue","Financial Year",
              "Full Name","Business Type","Age Category","Gender","Phone Number",
              "National ID","Location","Consent","Recorded At"].map(col => (
              <span key={col} className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">{col}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterBadge({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 px-2.5 py-1 bg-kibt-green/10 text-kibt-green rounded-full text-xs font-medium">
      {label}
      <button onClick={onRemove} className="ml-0.5 hover:text-red-500">×</button>
    </span>
  );
}
