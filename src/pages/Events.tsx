import React from "react";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus, Trash2, ScanLine, Calendar, MapPin, Users,
  Globe, Monitor, ChevronDown, ChevronUp, Clock, PlusCircle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { createEvent, deleteEvent, getEvents } from "../hooks/useTauri";
import { deleteSession } from "../hooks/useTauri";
import { KIBT_REGIONS, EVENT_TYPES, EventSession } from "../types";
import PageHeader from "../components/PageHeader";
import ConfirmDialog from "../components/ConfirmDialog";

interface EventStats { participantCount: number; scanCount: number; sessionCount: number; }
interface PendingDelete { id: string; title: string; stats: EventStats; }
interface PendingSessionDelete { id: string; title: string; }

const TYPE_ICON = {
  "in-person": <MapPin size={13} />,
  "online":    <Globe size={13} />,
  "hybrid":    <Monitor size={13} />,
};

export default function Events() {
  const { selectedFY, setSelectedFY, setFinancialYears, financialYears, addToast, currentUser, config } = useStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingSessionDelete, setPendingSessionDelete] = useState<PendingSessionDelete | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showSessionForm, setShowSessionForm] = useState<string | null>(null);
  const canDelete = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const { data: events, isLoading } = useQuery({
    queryKey: ["events", selectedFY],
    queryFn: () => getEvents(selectedFY),
  });

  const createMut = useMutation({
    mutationFn: createEvent,
    onSuccess: (newEvent) => {
      // Auto-switch FY to match the new event's FY
      const newFY = (newEvent as any).financialYear;
      if (newFY && newFY !== selectedFY) {
        setSelectedFY(newFY);
        if (!financialYears.includes(newFY)) {
          setFinancialYears([newFY, ...financialYears].sort().reverse());
        }
      }
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      qc.invalidateQueries({ queryKey: ["financial_years"] });
      setShowForm(false);
      addToast({ type: "success", message: `Event created for FY ${newFY}.` });
    },
    onError: (e: Error) => addToast({ type: "error", message: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      qc.invalidateQueries({ queryKey: ["participants"] });
      addToast({ type: "success", message: "Event and all related data permanently deleted." });
      setPendingDelete(null);
    },
    onError: (e: Error) => { addToast({ type: "error", message: e.message }); setPendingDelete(null); },
  });

  const deleteSessionMut = useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      addToast({ type: "success", message: "Session deleted." });
      setPendingSessionDelete(null);
    },
    onError: (e: Error) => { addToast({ type: "error", message: e.message }); setPendingSessionDelete(null); },
  });

  const handleDeleteClick = async (ev: { id: string; title: string }) => {
    setStatsLoading(true);
    try {
      const stats: EventStats = await invoke("get_event_stats", { eventId: ev.id });
      setPendingDelete({ id: ev.id, title: ev.title, stats });
    } catch {
      setPendingDelete({ id: ev.id, title: ev.title, stats: { participantCount: 0, scanCount: 0, sessionCount: 0 } });
    } finally { setStatsLoading(false); }
  };

  const buildConsequences = (stats: EventStats, title: string) => {
    const list = [`Delete the event record: "${title}"`];
    if (stats.sessionCount > 0) list.push(`Remove ${stats.sessionCount} session${stats.sessionCount !== 1 ? "s" : ""}`);
    if (stats.participantCount > 0) list.push(`Permanently erase ${stats.participantCount} participant record${stats.participantCount !== 1 ? "s" : ""}`);
    if (stats.scanCount > 0) list.push(`Remove ${stats.scanCount} scan log${stats.scanCount !== 1 ? "s" : ""} and photographs`);
    list.push("Remove this event from all reports and annual statistics");
    return list;
  };

  const typeMeta = (t: string) => EVENT_TYPES.find(x => x.value === t) ?? EVENT_TYPES[0];

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Events"
        subtitle={`Training events — FY ${selectedFY}`}
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={15} /> New Event</button>}
      />

      <div className="px-8 py-6 space-y-4">
        {showForm && (
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">New Training Event</h2>
            <EventForm
              defaultRegion={config?.defaultRegion}
              onSubmit={(data) => createMut.mutate(data as any)}
              onCancel={() => setShowForm(false)}
              loading={createMut.isPending}
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading events…</div>
        ) : !events || events.length === 0 ? (
          <div className="card p-12 text-center">
            <Calendar size={40} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-500 text-sm">No events for FY {selectedFY}.</p>
            <p className="text-xs text-gray-400 mt-1">Events for other years are accessible via the FY selector in the sidebar.</p>
            <button className="btn-primary mt-4" onClick={() => setShowForm(true)}><Plus size={14} /> Create first event</button>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => {
              const meta = typeMeta(ev.eventType);
              const isExpanded = expandedId === ev.id;
              const multiDay = ev.startDate !== ev.endDate;
              return (
                <div key={ev.id} className="card overflow-hidden">
                  {/* Event row */}
                  <div className="p-5 flex items-center justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                        <Calendar size={20} className="text-kibt-green" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-900">{ev.title}</h3>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                            {TYPE_ICON[ev.eventType as keyof typeof TYPE_ICON]} {meta.label}
                          </span>
                        </div>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><MapPin size={11} /> {ev.region}</span>
                          {ev.venue && <span>· {ev.venue}</span>}
                          <span>· {multiDay ? `${ev.startDate} → ${ev.endDate}` : ev.startDate}</span>
                          <span>· FY {ev.financialYear}</span>
                          {(ev.sessionCount ?? 0) > 0 && (
                            <span className="text-blue-500">· {ev.sessionCount} session{ev.sessionCount !== 1 ? "s" : ""}</span>
                          )}
                        </div>
                        {ev.notes && <p className="text-xs text-gray-400 mt-1">{ev.notes}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right mr-1">
                        <div className="flex items-center gap-1 text-sm font-semibold text-gray-700">
                          <Users size={13} className="text-gray-400" />{ev.participantCount ?? 0}
                        </div>
                        <div className="text-xs text-gray-400">participants</div>
                      </div>
                      <button className="btn-secondary text-xs" onClick={() => navigate(`/scan?event=${ev.id}`)}>
                        <ScanLine size={13} /> Scan
                      </button>
                      <button
                        className={`p-1.5 rounded-lg transition-colors ${isExpanded ? "bg-gray-100 text-gray-600" : "text-gray-400 hover:bg-gray-100"}`}
                        onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                        title="Manage sessions"
                      >
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                      {canDelete && (
                        <button
                          className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 disabled:opacity-40"
                          disabled={statsLoading}
                          onClick={() => handleDeleteClick({ id: ev.id, title: ev.title })}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sessions panel */}
                  {isExpanded && (
                    <SessionsPanel
                      eventId={ev.id}
                      eventStartDate={ev.startDate}
                      eventEndDate={ev.endDate}
                      eventRegion={ev.region}
                      canDelete={canDelete}
                      showForm={showSessionForm === ev.id}
                      onShowForm={() => setShowSessionForm(ev.id)}
                      onHideForm={() => setShowSessionForm(null)}
                      onDeleteSession={(s) => setPendingSessionDelete({ id: s.id, title: s.title ?? `Session ${s.sessionNo}` })}
                      onNavigateScan={(sid) => navigate(`/scan?event=${ev.id}&session=${sid}`)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="Delete Training Event?"
        message={"Permanently delete \"" + (pendingDelete?.title ?? "") + "\" and ALL associated data?"}
        consequences={pendingDelete ? buildConsequences(pendingDelete.stats, pendingDelete.title) : []}
        confirmLabel="Yes, Delete Everything"
        onConfirm={() => pendingDelete && deleteMut.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
        loading={deleteMut.isPending}
      />

      <ConfirmDialog
        isOpen={!!pendingSessionDelete}
        title="Delete Session?"
        message={"Delete \"" + (pendingSessionDelete?.title ?? "") + "\"? Participants linked to this session will remain but will lose their session assignment."}
        consequences={["Remove this session from the event timeline"]}
        confirmLabel="Delete Session"
        onConfirm={() => pendingSessionDelete && deleteSessionMut.mutate(pendingSessionDelete.id)}
        onCancel={() => setPendingSessionDelete(null)}
        loading={deleteSessionMut.isPending}
      />
    </div>
  );
}

// ── Sessions Panel ─────────────────────────────────────────────────────────────

function SessionsPanel({ eventId, eventStartDate, eventEndDate, eventRegion, canDelete,
  showForm, onShowForm, onHideForm, onDeleteSession, onNavigateScan }: {
  eventId: string; eventStartDate: string; eventEndDate: string; eventRegion: string;
  canDelete: boolean; showForm: boolean;
  onShowForm: () => void; onHideForm: () => void;
  onDeleteSession: (s: EventSession) => void;
  onNavigateScan: (sid: string) => void;
}) {
  const { addToast } = useStore();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: "", date: eventStartDate, startTime: "", endTime: "", region: eventRegion, venue: "",
  });

  const regionOptions = useMemo(() =>
    KIBT_REGIONS.map(r => <option key={r} value={r}>{r}</option>),
  []);

  const { data: sessions } = useQuery({
    queryKey: ["sessions", eventId],
    queryFn: () => import("../hooks/useTauri").then(m => m.getEventSessions(eventId)),
  });

  const createMut = useMutation({
    mutationFn: (input: any) => import("../hooks/useTauri").then(m => m.createSession(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions", eventId] });
      qc.invalidateQueries({ queryKey: ["events"] });
      onHideForm();
      addToast({ type: "success", message: "Session added." });
    },
    onError: (e: Error) => addToast({ type: "error", message: e.message }),
  });

  return (
    <div className="border-t border-gray-100 bg-gray-50/50 px-5 pb-4 pt-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sessions</h4>
        <button className="text-xs text-kibt-green hover:underline flex items-center gap-1" onClick={onShowForm}>
          <PlusCircle size={12} /> Add Session
        </button>
      </div>

      {/* Add session form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <label className="label">Session Title (optional)</label>
              <input className="input text-sm" placeholder="e.g. Morning Session"
                value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
            </div>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input text-sm" value={form.date}
                min={eventStartDate} max={eventEndDate}
                onChange={e => setForm({...form, date: e.target.value})} />
            </div>
            <div>
              <label className="label">Start Time</label>
              <input type="time" className="input text-sm" value={form.startTime}
                onChange={e => setForm({...form, startTime: e.target.value})} />
            </div>
            <div>
              <label className="label">End Time</label>
              <input type="time" className="input text-sm" value={form.endTime}
                onChange={e => setForm({...form, endTime: e.target.value})} />
            </div>
            <div>
              <label className="label">Region</label>
              <select className="select text-sm" value={form.region}
                onChange={e => setForm({...form, region: e.target.value})}>
                {regionOptions}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Venue</label>
              <input className="input text-sm" placeholder="Hall, room, or online link"
                value={form.venue} onChange={e => setForm({...form, venue: e.target.value})} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary text-xs" onClick={onHideForm}>Cancel</button>
            <button className="btn-primary text-xs" disabled={createMut.isPending}
              onClick={() => createMut.mutate({
                eventId, title: form.title || undefined, date: form.date,
                startTime: form.startTime || undefined, endTime: form.endTime || undefined,
                region: form.region || undefined, venue: form.venue || undefined,
              })}>
              {createMut.isPending ? "Adding…" : "Add Session"}
            </button>
          </div>
        </div>
      )}

      {/* Sessions list */}
      {!sessions || sessions.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">
          No sessions yet. Add sessions for multi-day events or different time slots.
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-gray-100">
              <div>
                <span className="text-xs font-semibold text-gray-700">
                  Session {s.sessionNo}{s.title ? ` — ${s.title}` : ""}
                </span>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <span><Calendar size={10} className="inline mr-0.5" />{s.date}</span>
                  {s.startTime && <span><Clock size={10} className="inline mr-0.5" />{s.startTime}{s.endTime ? ` – ${s.endTime}` : ""}</span>}
                  {s.region && <span><MapPin size={10} className="inline mr-0.5" />{s.region}</span>}
                  {s.venue && <span>· {s.venue}</span>}
                  <span className="text-green-600"><Users size={10} className="inline mr-0.5" />{s.participantCount ?? 0}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <button className="text-xs text-kibt-green hover:underline px-2"
                  onClick={() => onNavigateScan(s.id)}>Scan</button>
                {canDelete && (
                  <button onClick={() => onDeleteSession(s)}
                    className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Event creation form ────────────────────────────────────────────────────────

function EventForm({ defaultRegion, onSubmit, onCancel, loading }: {
  defaultRegion?: string;
  onSubmit: (d: any) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "", startDate: today, endDate: today,
    region: defaultRegion ?? "Nairobi", venue: "",
    eventType: "in-person", notes: "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const regionOptions = useMemo(() =>
    KIBT_REGIONS.map(r => <option key={r} value={r}>{r}</option>),
  []);

  const eventTypeOptions = useMemo(() =>
    EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>),
  []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Event Title *</label>
          <input className="input" placeholder="e.g. Business Skills Training — Nakuru"
            value={form.title} onChange={set("title")} />
        </div>
        <div>
          <label className="label">Start Date *</label>
          <input type="date" className="input" value={form.startDate} onChange={(e) => {
            setForm(p => ({ ...p, startDate: e.target.value,
              endDate: e.target.value > p.endDate ? e.target.value : p.endDate }));
          }} />
        </div>
        <div>
          <label className="label">End Date * <span className="text-gray-400">(same as start for 1-day)</span></label>
          <input type="date" className="input" value={form.endDate} min={form.startDate}
            onChange={set("endDate")} />
        </div>
        <div>
          <label className="label">Event Type *</label>
          <select className="select" value={form.eventType} onChange={set("eventType")}>
            {eventTypeOptions}
          </select>
        </div>
        <div>
          <label className="label">Primary Region *</label>
          <select className="select" value={form.region} onChange={set("region")}>
            {regionOptions}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">
            Venue {form.eventType === "online" ? "(link or platform)" : ""}
          </label>
          <input className="input"
            placeholder={form.eventType === "online" ? "e.g. Zoom link / Google Meet" : "e.g. KIBT Nakuru Training Hall"}
            value={form.venue} onChange={set("venue")} />
        </div>
        <div className="col-span-2">
          <label className="label">Notes</label>
          <textarea className="input resize-none" rows={2} placeholder="Optional notes"
            value={form.notes} onChange={set("notes") as any} />
        </div>
      </div>
      <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700">
        <strong>Tip:</strong> For multi-day events, set start and end dates. 
        After creating, expand the event to add individual sessions (morning/afternoon, different venues, etc.).
        Online participants can be from any county — assign their county when scanning or importing.
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={loading || !form.title.trim()}
          onClick={() => onSubmit({ title: form.title.trim(), startDate: form.startDate,
            endDate: form.endDate, region: form.region, venue: form.venue || undefined,
            eventType: form.eventType, notes: form.notes || undefined })}>
          {loading ? "Creating…" : "Create Event"}
        </button>
      </div>
    </div>
  );
}
