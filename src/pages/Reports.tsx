import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Users, Calendar, MapPin, UserCheck, FileSpreadsheet, FileText } from "lucide-react";
import { useStore } from "../store";
import { getReport, exportReportExcel, exportReportCsv } from "../hooks/useTauri";
import PageHeader from "../components/PageHeader";

export default function Reports() {
  const { selectedFY, addToast } = useStore();
  const [exporting, setExporting] = useState<"excel" | "csv" | null>(null);

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", selectedFY],
    queryFn: () => getReport(selectedFY),
    staleTime: 5 * 60_000, // 5 minutes — reports are aggregations
    gcTime: 15 * 60_000,   // 15 minutes
  });

  const handleExportReport = async (format: "excel" | "csv") => {
    setExporting(format);
    try {
      const fyLabel = selectedFY.replace("/", "-");
      const defaultName = `KIBT_Summary_Report_${fyLabel}.${format === "excel" ? "xlsx" : "csv"}`;
      const path = await save({
        defaultPath: defaultName,
        filters: format === "excel"
          ? [{ name: "Excel", extensions: ["xlsx"] }]
          : [{ name: "CSV",   extensions: ["csv"]  }],
      });
      if (!path) return;

      if (format === "excel") await exportReportExcel(selectedFY, path);
      else                    await exportReportCsv(selectedFY, path);

      addToast({ type: "success", message: `Summary report exported to ${path.split(/[\\\/]/).pop()}` });
    } catch (e: any) {
      addToast({ type: "error", message: String(e) });
    } finally {
      setExporting(null);
    }
  };

  const exportButtons = (
    <div className="flex gap-2">
      <button className="btn-secondary" onClick={() => handleExportReport("excel")} disabled={exporting !== null}>
        <FileSpreadsheet size={14} /> {exporting === "excel" ? "Exporting…" : "Export Excel"}
      </button>
      <button className="btn-secondary" onClick={() => handleExportReport("csv")} disabled={exporting !== null}>
        <FileText size={14} /> {exporting === "csv" ? "Exporting…" : "Export CSV"}
      </button>
    </div>
  );

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen text-gray-400 text-sm">Loading report…</div>
  );

  if (!report || report.totalParticipants === 0) return (
    <div className="min-h-full page-bg">
      <PageHeader
        title={`Annual Report — FY ${selectedFY}`}
        subtitle="Kenya Institute of Business Training — Statistical Summary"
      />
      <div className="flex items-center justify-center h-96 text-gray-400 text-sm">
        No data available for FY {selectedFY}. Create events and scan participants to generate reports.
      </div>
    </div>
  );

  const malePercent = report.totalParticipants > 0
    ? ((report.maleCount / report.totalParticipants) * 100).toFixed(1)
    : "0";
  const femalePercent = report.totalParticipants > 0
    ? ((report.femaleCount / report.totalParticipants) * 100).toFixed(1)
    : "0";

  return (
    <div className="min-h-full page-bg">
      <PageHeader
        title={`Annual Report — FY ${selectedFY}`}
        subtitle="Kenya Institute of Business Training — Statistical Summary"
        actions={exportButtons}
      />

      <div className="px-8 py-6 space-y-6">
        {/* ── Headline stats ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <HeadlineStat icon={<Users size={20} className="text-kibt-green" />} label="Total Participants" value={report.totalParticipants} bg="bg-green-50" />
          <HeadlineStat icon={<Calendar size={20} className="text-blue-600" />} label="Training Events" value={report.totalEvents} bg="bg-blue-50" />
          <HeadlineStat icon={<MapPin size={20} className="text-purple-600" />} label="Active Regions" value={report.activeRegions} bg="bg-purple-50" />
          <HeadlineStat icon={<UserCheck size={20} className="text-amber-600" />} label="Consented" value={report.consentCount} bg="bg-amber-50" />
        </div>

        {/* ── Gender + Age summary ─────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Gender Distribution</h3>
            <div className="space-y-3">
              <PercentBar label={`Male (${malePercent}%)`} count={report.maleCount} total={report.totalParticipants} color="bg-blue-500" />
              <PercentBar label={`Female (${femalePercent}%)`} count={report.femaleCount} total={report.totalParticipants} color="bg-pink-400" />
            </div>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Age Category</h3>
            <div className="space-y-3">
              <PercentBar label="Above 35 (Cat. A)" count={report.ageACount} total={report.totalParticipants} color="bg-orange-400" />
              <PercentBar label="Below 35 (Cat. B)" count={report.ageBCount} total={report.totalParticipants} color="bg-teal-400" />
            </div>
          </div>
        </div>

        {/* ── Regional breakdown ────────────────────────────────────── */}
        {report.regions.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Regional Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2 font-medium">Region</th>
                    <th className="pb-2 font-medium text-right">Events</th>
                    <th className="pb-2 font-medium text-right">Participants</th>
                    <th className="pb-2 font-medium text-right">Male</th>
                    <th className="pb-2 font-medium text-right">Female</th>
                    <th className="pb-2 font-medium text-right">Cat. A</th>
                    <th className="pb-2 font-medium text-right">Cat. B</th>
                    <th className="pb-2 font-medium text-right">Consented</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.regions.map((r) => (
                    <tr key={r.region} className="hover:bg-gray-50">
                      <td className="py-2.5 font-medium text-gray-800">{r.region}</td>
                      <td className="py-2.5 text-right text-gray-600">{r.events}</td>
                      <td className="py-2.5 text-right font-semibold text-gray-800">{r.participants}</td>
                      <td className="py-2.5 text-right text-blue-600">{r.male}</td>
                      <td className="py-2.5 text-right text-pink-500">{r.female}</td>
                      <td className="py-2.5 text-right text-orange-600">{r.ageA}</td>
                      <td className="py-2.5 text-right text-teal-600">{r.ageB}</td>
                      <td className="py-2.5 text-right text-green-600">{r.consent}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 font-semibold text-gray-800">
                  <tr>
                    <td className="pt-2">TOTAL</td>
                    <td className="pt-2 text-right">{report.totalEvents}</td>
                    <td className="pt-2 text-right">{report.totalParticipants}</td>
                    <td className="pt-2 text-right text-blue-600">{report.maleCount}</td>
                    <td className="pt-2 text-right text-pink-500">{report.femaleCount}</td>
                    <td className="pt-2 text-right text-orange-600">{report.ageACount}</td>
                    <td className="pt-2 text-right text-teal-600">{report.ageBCount}</td>
                    <td className="pt-2 text-right text-green-600">{report.consentCount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── Business type frequency ───────────────────────────────── */}
        {report.businessTypes.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Business Types</h3>
            <div className="space-y-2">
              {report.businessTypes.map((bt) => (
                <PercentBar
                  key={bt.businessType}
                  label={bt.businessType}
                  count={bt.count}
                  total={report.totalParticipants}
                  color="bg-kibt-green"
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Event list ─────────────────────────────────────────────── */}
        {report.events.length > 0 && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">All Events ({report.events.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Event</th>
                    <th className="pb-2 font-medium">Region</th>
                    <th className="pb-2 font-medium">Venue</th>
                    <th className="pb-2 font-medium text-right">Participants</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="py-2 text-gray-500 text-xs">{ev.startDate ?? ev.date ?? ""}</td>
                      <td className="py-2 font-medium text-gray-800">{ev.title}</td>
                      <td className="py-2 text-gray-600">{ev.region}</td>
                      <td className="py-2 text-gray-500 text-xs">{ev.venue ?? "—"}</td>
                      <td className="py-2 text-right font-semibold text-gray-800">{ev.participantCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HeadlineStat({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: number; bg: string }) {
  return (
    <div className="card p-5">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>{icon}</div>
      <div className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function PercentBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="font-medium">{count.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
