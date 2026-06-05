import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Calendar, MapPin, UserCheck, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { getReport, getEvents } from "../hooks/useTauri";
import PageHeader from "../components/PageHeader";

export default function Dashboard() {
  const { selectedFY } = useStore();
  const navigate = useNavigate();

  const { data: report, isLoading } = useQuery({
    queryKey: ["report", selectedFY],
    queryFn: () => getReport(selectedFY),
    staleTime: 5 * 60_000, // 5 minutes
    gcTime: 15 * 60_000,   // 15 minutes
  });

  const { data: recentEvents } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
    staleTime: 3 * 60_000, // 3 minutes
    gcTime: 10 * 60_000,   // 10 minutes
  });

  const malePercent = report && report.totalParticipants > 0
    ? Math.round((report.maleCount / report.totalParticipants) * 100)
    : 0;
  const femalePercent = 100 - malePercent;
  const consentPercent = report && report.totalParticipants > 0
    ? Math.round((report.consentCount / report.totalParticipants) * 100)
    : 0;

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title={`Dashboard — FY ${selectedFY}`}
        subtitle="Kenya Institute of Business Training — Attendance Overview"
      />

      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            Loading statistics…
          </div>
        ) : (
          <>
            {/* ── Key stats ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={<Users size={20} className="text-kibt-green" />}
                label="Total Participants"
                value={report?.totalParticipants?.toLocaleString() ?? "0"}
                bg="bg-green-50"
              />
              <StatCard
                icon={<Calendar size={20} className="text-blue-600" />}
                label="Training Events"
                value={report?.totalEvents?.toLocaleString() ?? "0"}
                bg="bg-blue-50"
              />
              <StatCard
                icon={<MapPin size={20} className="text-purple-600" />}
                label="Active Regions"
                value={report?.activeRegions?.toLocaleString() ?? "0"}
                bg="bg-purple-50"
              />
              <StatCard
                icon={<UserCheck size={20} className="text-amber-600" />}
                label="Consented"
                value={`${consentPercent}%`}
                sub={`${report?.consentCount ?? 0} participants`}
                bg="bg-amber-50"
              />
            </div>

            {/* ── Gender split + Age split ─────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Gender Distribution</h3>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Male ({malePercent}%)</span>
                      <span>{report?.maleCount ?? 0}</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${malePercent}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Female ({femalePercent}%)</span>
                      <span>{report?.femaleCount ?? 0}</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-pink-400 rounded-full transition-all duration-500"
                        style={{ width: `${femalePercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Age Category</h3>
                <div className="space-y-3">
                  <AgeBar
                    label="Above 35 (Category A)"
                    count={report?.ageACount ?? 0}
                    total={report?.totalParticipants ?? 0}
                    color="bg-orange-400"
                  />
                  <AgeBar
                    label="Below 35 (Category B)"
                    count={report?.ageBCount ?? 0}
                    total={report?.totalParticipants ?? 0}
                    color="bg-teal-400"
                  />
                </div>
              </div>
            </div>

            {/* ── Recent events ────────────────────────────────────── */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Recent Events</h3>
                <button
                  onClick={() => navigate("/events")}
                  className="text-xs text-kibt-green hover:text-kibt-green-light flex items-center gap-1"
                >
                  View all <ArrowRight size={12} />
                </button>
              </div>
              {!recentEvents || recentEvents.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  No events yet for FY {selectedFY}.{" "}
                  <button
                    onClick={() => navigate("/events")}
                    className="text-kibt-green underline"
                  >
                    Create one
                  </button>
                </p>
              ) : (
                <div className="space-y-2">
                  {recentEvents.slice(0, 6).map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{ev.title}</p>
                        <p className="text-xs text-gray-500">{ev.region} · {ev.startDate}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-gray-700">{ev.participantCount ?? 0}</span>
                        <p className="text-xs text-gray-400">participants</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Top regions ─────────────────────────────────────── */}
            {report && report.regions.length > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Regional Summary</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="pb-2 font-medium">Region</th>
                        <th className="pb-2 font-medium text-right">Events</th>
                        <th className="pb-2 font-medium text-right">Participants</th>
                        <th className="pb-2 font-medium text-right">Male</th>
                        <th className="pb-2 font-medium text-right">Female</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {report.regions.slice(0, 8).map((r) => (
                        <tr key={r.region} className="hover:bg-gray-50">
                          <td className="py-2 font-medium text-gray-800">{r.region}</td>
                          <td className="py-2 text-right text-gray-600">{r.events}</td>
                          <td className="py-2 text-right font-semibold text-gray-800">{r.participants}</td>
                          <td className="py-2 text-right text-blue-600">{r.male}</td>
                          <td className="py-2 text-right text-pink-500">{r.female}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, bg }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  bg: string;
}) {
  return (
    <div className="card p-5">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function AgeBar({ label, count, total, color }: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label} ({pct}%)</span>
        <span>{count}</span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
