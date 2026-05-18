type BarItem = {
  label: string;
  value: number;
  tone?: "blue" | "red" | "orange" | "teal";
};

export function BarChart({ items }: { items: BarItem[] }) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="barList">
      {items.map((item) => (
        <div className="barRow" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div className="barTrack">
            <div className={`barFill ${item.tone || ""}`} style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
