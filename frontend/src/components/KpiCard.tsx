export function KpiCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "low" | "medium" | "high" | "critical";
}) {
  return (
    <div className={`card kpi ${tone ? `kpi-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
