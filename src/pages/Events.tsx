import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ScanLine, Calendar, MapPin, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { createEvent, deleteEvent, getEvents } from "../hooks/useTauri";
import { KIBT_REGIONS } from "../types";
import PageHeader from "../components/PageHeader";

export default function Events() {
  const { selectedFY, addToast, currentUser } = useStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
  });

  const createMut = useMutation({
    mutationFn: createEvent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      qc.invalidateQueries({ queryKey: ["financial_years"] });
      setShowForm(false);
      addToast({ type: "success", message: "Event created." });
    },
    onError: (e: Error) => addToast({ type: "error", message: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      addToast({ type: "success", message: "Event deleted." });
    },
    onError: (e: Error) => addToast({ type: "error", message: e.message }),
  });

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Events"
        subtitle={`Training events — FY ${selectedFY}`}
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={15} /> New Event
          </button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Create event form */}
        {showForm && (
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">New Training Event</h2>
            <EventForm
              onSubmit={(data) => createMut.mutate(data)}
              onCancel={() => setShowForm(false)}
              loading={createMut.isPending}
            />
          </div>
        )}

        {/* Events list */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading events…</div>
        ) : !events || events.length === 0 ? (
          <div className="card p-12 text-center">
            <Calendar size={40} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-500 text-sm">No events for FY {selectedFY}.</p>
            <button className="btn-primary mt-4" onClick={() => setShowForm(true)}>
              <Plus size={14} /> Create first event
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <div key={ev.id} className="card p-5 flex items-center justify-between hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                    <Calendar size={20} className="text-kibt-green" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{ev.title}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin size={11} /> {ev.region}
                      </span>
                      {ev.venue && <span>· {ev.venue}</span>}
                      <span>· {ev.date}</span>
                      <span>· FY {ev.financialYear}</span>
                    </div>
                    {ev.notes && <p className="text-xs text-gray-400 mt-1">{ev.notes}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right mr-2">
                    <div className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                      <Users size={13} className="text-gray-400" />
                      {ev.participantCount ?? 0}
                    </div>
                    <div className="text-xs text-gray-400">participants</div>
                  </div>
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => navigate(`/scan?event=${ev.id}`)}
                  >
                    <ScanLine size={13} /> Scan Sheet
                  </button>
                  {(currentUser?.role === "admin" || currentUser?.role === "super_admin") && (
                    <button
                      className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`Delete "${ev.title}" and all its participants?`)) {
                          deleteMut.mutate(ev.id);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Event creation form ────────────────────────────────────────────────────────

interface FormData {
  title: string;
  date: string;
  region: string;
  venue: string;
  notes: string;
}

function EventForm({
  onSubmit,
  onCancel,
  loading,
}: {
  onSubmit: (data: { title: string; date: string; region: string; venue?: string; notes?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<FormData>({
    title: "",
    date: new Date().toISOString().slice(0, 10),
    region: "Nairobi",
    venue: "",
    notes: "",
  });

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    onSubmit({
      title: form.title.trim(),
      date: form.date,
      region: form.region,
      venue: form.venue.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Event Title *</label>
          <input
            className="input"
            placeholder="e.g. Business Skills Training Day 1"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Date *</label>
          <input
            type="date"
            className="input"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Region *</label>
          <select
            className="select"
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
          >
            {KIBT_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Venue</label>
          <input
            className="input"
            placeholder="e.g. KIBT Nairobi Training Hall"
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Notes</label>
          <input
            className="input"
            placeholder="Optional notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={loading || !form.title.trim()}>
          {loading ? "Creating…" : "Create Event"}
        </button>
      </div>
    </div>
  );
}
