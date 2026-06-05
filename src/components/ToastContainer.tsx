import { useEffect } from "react";
import { CheckCircle, XCircle, AlertCircle, Info, X } from "lucide-react";
import { useStore, Toast } from "../store";

const ICONS = {
  success: <CheckCircle size={16} className="text-green-600" />,
  error:   <XCircle size={16} className="text-red-600" />,
  warning: <AlertCircle size={16} className="text-amber-600" />,
  info:    <Info size={16} className="text-blue-600" />,
};

const BG = {
  success: "bg-green-50 border-green-200",
  error:   "bg-red-50 border-red-200",
  warning: "bg-amber-50 border-amber-200",
  info:    "bg-blue-50 border-blue-200",
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useStore();

  useEffect(() => {
    const t = setTimeout(() => removeToast(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast.id]);

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm max-w-sm ${BG[toast.type]}`}>
      {ICONS[toast.type]}
      <span className="flex-1 text-gray-800">{toast.message}</span>
      <button onClick={() => removeToast(toast.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5">
        <X size={14} />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts } = useStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
