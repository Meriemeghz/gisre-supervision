"use client";

import type {
  HistoricalAnalytics,
  HistoricalPeriodPreset,
} from "@/lib/api/historical-analysis";

export type HistoricalFilterState = {
  preset: HistoricalPeriodPreset;
  startDate: string;
  endDate: string;
  flowCode: string;
  apiCode: string;
  producerCode: string;
  consumerCode: string;
  anomalyType: string;
};

export function HistoricalFilters({
  value,
  options,
  loading,
  onChange,
  onApply,
}: {
  value: HistoricalFilterState;
  options: HistoricalAnalytics["filter_options"] | null;
  loading: boolean;
  onChange: (value: HistoricalFilterState) => void;
  onApply: () => void;
}) {
  return (
    <section className="historicalFilters">
      <div className="historicalPresetControl" aria-label="Historical period">
        {(["24h", "7d", "30d", "90d", "custom"] as HistoricalPeriodPreset[]).map((preset) => (
          <button
            className={value.preset === preset ? "active" : ""}
            key={preset}
            type="button"
            onClick={() => onChange({ ...value, preset })}
          >
            {preset === "custom" ? "Custom" : preset}
          </button>
        ))}
      </div>

      <div className="historicalFilterGrid">
        {value.preset === "custom" && (
          <>
            <label>Start<input className="input" type="datetime-local" value={value.startDate} onChange={(event) => onChange({ ...value, startDate: event.target.value })} /></label>
            <label>End<input className="input" type="datetime-local" value={value.endDate} onChange={(event) => onChange({ ...value, endDate: event.target.value })} /></label>
          </>
        )}
        <FilterSelect label="Flow" value={value.flowCode} options={options?.flow_code || []} onChange={(flowCode) => onChange({ ...value, flowCode })} />
        <FilterSelect label="API" value={value.apiCode} options={options?.api_code || []} onChange={(apiCode) => onChange({ ...value, apiCode })} />
        <FilterSelect label="Producer" value={value.producerCode} options={options?.producer_code || []} onChange={(producerCode) => onChange({ ...value, producerCode })} />
        <FilterSelect label="Consumer" value={value.consumerCode} options={options?.consumer_code || []} onChange={(consumerCode) => onChange({ ...value, consumerCode })} />
        <FilterSelect label="Anomaly" value={value.anomalyType} options={options?.anomaly_type || []} onChange={(anomalyType) => onChange({ ...value, anomalyType })} />
        <button className="button primary historicalApplyButton" disabled={loading} type="button" onClick={onApply}>
          {loading ? "Loading..." : "Apply filters"}
        </button>
      </div>
    </section>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
