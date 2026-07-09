export function HistoricalSectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="historicalSectionTitle">
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      <p>{description}</p>
    </div>
  );
}
