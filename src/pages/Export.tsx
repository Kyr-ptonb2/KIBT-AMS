import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useStore } from "../store";
import { exportExcel, exportCsv } from "../hooks/useTauri";
import { KIBT_REGIONS } from "../types";
import PageHeader from "../components/PageHeader";

export default function Export() {
  const { selectedFY, addToast } = useStore();
  const [filterFY, setFilterFY] = useState(selectedFY);
  const [filterRegion, setFilterRegion] = useState("");
  const [loading, setLoading] = useState<"excel" | "csv" | null>(null);

  const handleExport = async (format: "excel" | "csv") => {
    setLoading(format);
    try {
      const defaultName = `KIBT_AMS_${filterFY.replace("/", "-")}${filterRegion ? `_${filterRegion}` : ""}.${format === "excel" ? "xlsx" : "csv"}`;

      const path = await save({
        defaultPath: defaultName,
        filters: format === "excel"
          ? [{ name: "Excel", extensions: ["xlsx"] }]
          : [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!path) return;

      const filter = {
        financialYear: filterFY || undefined,
        region: filterRegion || undefined,
      };

      if (format === "excel") {
        await exportExcel(filter, path);
      } else {
        await exportCsv(filter, path);
      }

      addToast({ type: "success", message: `Exported to ${path.split(/[\\/]/).pop()}` });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Export Data"
        subtitle="Download attendance records as Excel or CSV"
      />

      <div className="px-8 py-6 max-w-2xl space-y-5">
        {/* Filters */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">Export Filters</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Financial Year</label>
              <input className="input" value={filterFY} onChange={(e) => setFilterFY(e.target.value)} placeholder="e.g. 2024/2025" />
            </div>
            <div>
              <label className="label">Region (optional)</label>
              <select className="select" value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
                <option value="">All regions</option>
                {KIBT_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Export buttons */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <FileSpreadsheet size={22} className="text-kibt-green" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Excel (.xlsx)</h3>
              <p className="text-xs text-gray-500 mt-0.5">Formatted spreadsheet with headers — recommended for Ministry submission</p>
            </div>
            <button
              className="btn-primary w-full justify-center"
              onClick={() => handleExport("excel")}
              disabled={loading !== null}
            >
              {loading === "excel" ? "Exporting…" : <><Download size={14} /> Download Excel</>}
            </button>
          </div>

          <div className="card p-5 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <FileText size={22} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">CSV (.csv)</h3>
              <p className="text-xs text-gray-500 mt-0.5">Plain comma-separated values — for importing into other systems</p>
            </div>
            <button
              className="btn-secondary w-full justify-center"
              onClick={() => handleExport("csv")}
              disabled={loading !== null}
            >
              {loading === "csv" ? "Exporting…" : <><Download size={14} /> Download CSV</>}
            </button>
          </div>
        </div>

        {/* Columns info */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Exported Columns</h3>
          <div className="flex flex-wrap gap-2">
            {["Event Title", "Event Date", "Region", "Venue", "Financial Year",
              "Full Name", "Business Type", "Age Category", "Gender", "Phone Number",
              "Consent", "Recorded At"].map((col) => (
              <span key={col} className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">{col}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
