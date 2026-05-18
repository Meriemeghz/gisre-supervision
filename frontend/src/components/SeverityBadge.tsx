import type { Severity } from "@/lib/api";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${severity}`}>{severity}</span>;
}
