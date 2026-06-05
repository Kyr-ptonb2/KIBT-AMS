import { AlertTriangle, Trash2, X } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  consequences?: string[];   // bullet list of what will be deleted
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({
  isOpen, title, message, consequences = [],
  confirmLabel = "Delete", danger = true,
  onConfirm, onCancel, loading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in">
        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            danger ? "bg-red-100" : "bg-amber-100"
          }`}>
            {danger
              ? <Trash2 size={20} className="text-red-600" />
              : <AlertTriangle size={20} className="text-amber-600" />
            }
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-600 mt-1">{message}</p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Consequences list */}
        {consequences.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 mb-5">
            <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> This action will permanently:
            </p>
            <ul className="space-y-1.5">
              {consequences.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                  <span className="text-red-400 mt-0.5 flex-shrink-0">✕</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warning */}
        <p className="text-xs text-gray-500 mb-5">
          <strong>This cannot be undone.</strong> Make sure you have a backup if needed.
        </p>

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            className="btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
              danger
                ? "bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
                : "bg-amber-500 text-white hover:bg-amber-600"
            }`}
            onClick={onConfirm}
            disabled={loading}
          >
            <Trash2 size={14} />
            {loading ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
