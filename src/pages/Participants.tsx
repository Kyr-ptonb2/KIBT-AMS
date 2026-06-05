import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Pencil, Trash2, Check, X, Users, Filter } from "lucide-react";
import { useStore } from "../store";
import { getParticipants, updateParticipant, deleteParticipant } from "../hooks/useTauri";
import { Participant, ParticipantInput, KIBT_REGIONS, BUSINESS_TYPES } from "../types";
import PageHeader from "../components/PageHeader";
import ConfirmDialog from "../components/ConfirmDialog";

export default function Participants() {
  const { selectedFY, addToast, currentUser } = useStore();
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterAge, setFilterAge] = useState("");
  const [filterConsent, setFilterConsent] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<ParticipantInput | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteName, setPendingDeleteName] = useState<string>("");

  // Debounce the search query — wait 350ms after last keystroke before fetching
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data: participants, isLoading } = useQuery({
    queryKey: ["participants", selectedFY, debouncedQuery, filterRegion, filterGender, filterAge, filterConsent],
    queryFn: () =>
      getParticipants({
        financialYear: selectedFY,
        query: debouncedQuery || undefined,
        region: filterRegion || undefined,
        gender: filterGender || undefined,
        ageCategory: filterAge || undefined,
        consent: filterConsent || undefined,
      }),
    staleTime: 2 * 60_000, // 2 minutes
    gcTime: 10 * 60_000,   // 10 minutes
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ParticipantInput }) =>
      updateParticipant(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
      setEditId(null);
      setEditData(null);
      addToast({ type: "success", message: "Participant updated." });
    },
    onError: (e: Error) => addToast({ type: "error", message: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteParticipant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["participants"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      addToast({ type: "success", message: "Record deleted." });
    },
    onError: (e: Error) => addToast({ type: "error", message: e.message }),
  });

  const startEdit = (p: Participant) => {
    setEditId(p.id);
    setEditData({
      name: p.name,
      businessType: p.businessType,
      ageCategory: p.ageCategory,
      gender: p.gender,
      phone: p.phone,
      consent: p.consent,
    });
  };

  const commitEdit = () => {
    if (!editId || !editData) return;
    updateMut.mutate({ id: editId, input: editData });
  };

  return (
    <div className="min-h-full bg-gray-50">
      <PageHeader
        title="Participants"
        subtitle={`Database — FY ${selectedFY}`}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              {participants?.length ?? 0} records
            </span>
          </div>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* ── Search + filters ──────────────────────────────────────── */}
        <div className="card p-4 space-y-3">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Search by name or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              className="btn-secondary"
              onClick={() => setShowFilters((v) => !v)}
            >
              <Filter size={14} />
              Filters
              {(filterRegion || filterGender || filterAge || filterConsent) && (
                <span className="w-2 h-2 rounded-full bg-kibt-green ml-0.5" />
              )}
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-4 gap-3 pt-2 border-t border-gray-100">
              <div>
                <label className="label">Region</label>
                <select className="select" value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
                  <option value="">All regions</option>
                  {KIBT_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Gender</label>
                <select className="select" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                  <option value="">All</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
              <div>
                <label className="label">Age Category</label>
                <select className="select" value={filterAge} onChange={(e) => setFilterAge(e.target.value)}>
                  <option value="">All</option>
                  <option value="A">A (Above 35)</option>
                  <option value="B">B (Below 35)</option>
                </select>
              </div>
              <div>
                <label className="label">Consent</label>
                <select className="select" value={filterConsent} onChange={(e) => setFilterConsent(e.target.value)}>
                  <option value="">All</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* ── Table ─────────────────────────────────────────────────── */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
          ) : !participants || participants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Users size={36} className="mb-3 text-gray-200" />
              <p className="text-sm">No participants found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-3 py-3 font-medium">Business Type</th>
                    <th className="px-3 py-3 font-medium w-16">Age</th>
                    <th className="px-3 py-3 font-medium w-16">Gender</th>
                    <th className="px-3 py-3 font-medium">Phone</th>
                    <th className="px-3 py-3 font-medium">Region</th>
                    <th className="px-3 py-3 font-medium w-16">Consent</th>
                    <th className="px-3 py-3 font-medium w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {participants.map((p) => (
                    <ParticipantRow
                      key={p.id}
                      participant={p}
                      isEditing={editId === p.id}
                      editData={editId === p.id ? editData : null}
                      onEdit={() => startEdit(p)}
                      onSave={commitEdit}
                      onCancel={() => { setEditId(null); setEditData(null); }}
                      onDelete={() => { setPendingDeleteId(p.id); setPendingDeleteName(p.name); }}
                      canDelete={currentUser?.role === "admin" || currentUser?.role === "super_admin"}
                      onFieldChange={(field, value) =>
                        setEditData((prev) => prev ? { ...prev, [field]: value } : prev)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={!!pendingDeleteId}
        title="Delete Participant Record?"
        message={`You are about to permanently delete the attendance record for "${pendingDeleteName}".`}
        consequences={[
          `Remove "${pendingDeleteName}" from this event's participant list`,
          "This record will no longer appear in reports or statistics",
        ]}
        confirmLabel="Delete Record"
        onConfirm={() => { if (pendingDeleteId) { deleteMut.mutate(pendingDeleteId); setPendingDeleteId(null); } }}
        onCancel={() => setPendingDeleteId(null)}
        loading={deleteMut.isPending}
      />
    </div>
  );
}

function ParticipantRow({
  participant: p, isEditing, editData,
  onEdit, onSave, onCancel, onDelete, onFieldChange, canDelete,
}: {
  participant: Participant;
  isEditing: boolean;
  editData: ParticipantInput | null;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onFieldChange: (field: keyof ParticipantInput, value: string) => void;
  canDelete: boolean;
}) {
  if (isEditing && editData) {
    return (
      <tr className="bg-green-50/50">
        <td className="px-4 py-2">
          <input className="input text-xs" value={editData.name} onChange={(e) => onFieldChange("name", e.target.value)} />
        </td>
        <td className="px-3 py-2">
          <select className="select text-xs" value={editData.businessType ?? ""} onChange={(e) => onFieldChange("businessType", e.target.value)}>
            <option value="">—</option>
            {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
          </select>
        </td>
        <td className="px-3 py-2">
          <select className="select text-xs" value={editData.ageCategory ?? ""} onChange={(e) => onFieldChange("ageCategory", e.target.value)}>
            <option value="">—</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <select className="select text-xs" value={editData.gender ?? ""} onChange={(e) => onFieldChange("gender", e.target.value)}>
            <option value="">—</option>
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <input className="input text-xs" value={editData.phone ?? ""} onChange={(e) => onFieldChange("phone", e.target.value)} />
        </td>
        <td className="px-3 py-2">
          <select className="select text-xs" value={editData.consent ?? "No"} onChange={(e) => onFieldChange("consent", e.target.value)}>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <button onClick={onSave} className="p-1.5 rounded text-green-600 hover:bg-green-100"><Check size={14} /></button>
            <button onClick={onCancel} className="p-1.5 rounded text-gray-400 hover:bg-gray-100"><X size={14} /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 font-medium text-gray-800">{p.name}</td>
      <td className="px-3 py-2.5 text-gray-600">{p.businessType ?? <span className="text-gray-300">—</span>}</td>
      <td className="px-3 py-2.5 text-center">
        {p.ageCategory ? (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.ageCategory === "A" ? "bg-orange-100 text-orange-700" : "bg-teal-100 text-teal-700"}`}>
            {p.ageCategory}
          </span>
        ) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-center">
        {p.gender ? (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.gender === "M" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}`}>
            {p.gender}
          </span>
        ) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-gray-600 font-mono text-xs">{p.phone ?? <span className="text-gray-300 font-sans">—</span>}</td>
      <td className="px-3 py-2.5 text-xs text-gray-600">{p.region ?? <span className="text-gray-300">—</span>}</td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-xs font-medium ${p.consent === "Yes" ? "text-green-600" : "text-gray-400"}`}>
          {p.consent ?? "No"}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          <button onClick={onEdit} className="p-1.5 rounded text-gray-400 hover:text-kibt-green hover:bg-green-50">
            <Pencil size={13} />
          </button>
          {canDelete && (
            <button onClick={onDelete} className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
