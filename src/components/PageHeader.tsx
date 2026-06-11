import { ReactNode } from "react";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div
      className="flex items-start justify-between px-8 pt-7 pb-5 sticky top-0 z-10"
      style={{
        backgroundColor: "var(--bg-card)",
        borderBottom: "1px solid var(--border-light)",
      }}
    >
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-heading)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
