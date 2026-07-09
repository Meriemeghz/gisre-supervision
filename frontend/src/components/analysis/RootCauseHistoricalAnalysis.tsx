import {
  ANOMALY_FAMILY_COLORS,
  getAnomalyFamily,
} from "@/lib/anomaly-family";
import type { HistoricalRootCauseChain } from "@/lib/api/historical-analysis";
import { HistoricalSectionTitle } from "./HistoricalSectionTitle";

type NodeKind = "producer" | "api" | "anomaly";

type SankeyNode = {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  total: number;
  averageRisk: number;
  averageSeverity: number;
  dominantAnomaly?: string;
  criticality?: HistoricalRootCauseChain["criticality"];
};

type SankeyLink = {
  id: string;
  source: SankeyNode;
  target: SankeyNode;
  occurrences: number;
  averageRisk: number;
  color: string;
};

const CHART_WIDTH = 1180;
const NODE_WIDTH = 190;
const NODE_HEIGHT = 44;
const COLUMN_X: Record<NodeKind, number> = {
  producer: 30,
  api: 495,
  anomaly: 960,
};

export function RootCauseHistoricalAnalysis({
  chains,
  mode = "all",
  tableLimit = 15,
}: {
  chains: HistoricalRootCauseChain[];
  mode?: "all" | "sankey" | "table" | "interpretation";
  tableLimit?: number;
}) {
  const validChains = chains
    .filter((chain) => chain.producer_code && chain.api_code && chain.anomaly_type)
    .sort((left, right) =>
      Number(right.average_risk_score || 0) - Number(left.average_risk_score || 0)
      || right.occurrences - left.occurrences,
    );

  return (
    <section className="historicalSection">
      <HistoricalSectionTitle
        eyebrow="Historical root cause"
        title="Anomaly propagation paths"
        description="Producer to API to anomaly relationships, weighted by observed occurrences."
      />

      {!validChains.length ? (
        <div className="historicalEmptyState">
          No root cause relationships found for the selected period.
        </div>
      ) : (
        <>
          {(mode === "all" || mode === "sankey") && <RootCauseSankey chains={validChains} />}
          {(mode === "all" || mode === "interpretation") && <RootCauseInterpretation chains={validChains} />}
          {(mode === "all" || mode === "table") && <TopRootCauseChains chains={validChains} limit={tableLimit} />}
        </>
      )}
    </section>
  );
}

function RootCauseSankey({ chains }: { chains: HistoricalRootCauseChain[] }) {
  const diagram = buildSankey(chains.slice(0, 30));
  const maxOccurrences = Math.max(1, ...diagram.links.map((link) => link.occurrences));

  return (
    <article className="rootCauseSankeyPanel">
      <header className="rootCauseSankeyHeader">
        <div><span>PRODUCERS</span><small>Origin components</small></div>
        <div><span>APIS</span><small>Exposed operations</small></div>
        <div><span>ANOMALIES</span><small>Observed outcomes</small></div>
      </header>
      <div className="rootCauseSankeyScroll">
        <svg
          className="rootCauseSankey"
          viewBox={`0 0 ${CHART_WIDTH} ${diagram.height}`}
          style={{ minHeight: diagram.height }}
          role="img"
          aria-label="Root cause Sankey diagram linking producers, APIs and anomaly types"
        >
          <g className="rootCauseLinks">
            {diagram.links.map((link) => (
              <path
                key={link.id}
                d={linkPath(link)}
                stroke={link.color}
                strokeWidth={Math.max(2, (link.occurrences / maxOccurrences) * 22)}
              >
                <title>{`${link.source.label} -> ${link.target.label}\n${link.occurrences} occurrences\nAverage risk ${formatRisk(link.averageRisk)}`}</title>
              </path>
            ))}
          </g>
          <g className="rootCauseNodes">
            {diagram.nodes.map((node) => (
              <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx="6"
                  fill={nodeColor(node)}
                />
                <text x="12" y="18">{truncate(node.label, 23)}</text>
                <text className="rootCauseNodeMeta" x="12" y="34">
                  {node.total} anomalies / risk {formatRisk(node.averageRisk)}
                </text>
                <title>{nodeTooltip(node)}</title>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <footer className="rootCauseSankeyLegend">
        <span>Link width = occurrences</span>
        {Object.entries(ANOMALY_FAMILY_COLORS).map(([family, color]) => (
          <span key={family}><i style={{ background: color }} />{family}</span>
        ))}
      </footer>
    </article>
  );
}

function RootCauseInterpretation({ chains }: { chains: HistoricalRootCauseChain[] }) {
  const totalOccurrences = sum(chains.map((chain) => chain.occurrences));
  const totalRisk = sum(chains.map((chain) => Number(chain.risk_sum || 0)));
  const producer = topAggregate(chains, (chain) => chain.producer_code);
  const api = topAggregate(chains, (chain) => chain.api_code);
  const anomaly = topAggregate(chains, (chain) => chain.anomaly_type);
  const apiDominantAnomaly = topAggregate(
    chains.filter((chain) => chain.api_code === api.label),
    (chain) => chain.anomaly_type,
  );
  const topChain = [...chains].sort((left, right) =>
    Number(right.risk_sum || 0) - Number(left.risk_sum || 0),
  )[0];
  const producerShare = percent(producer.occurrences, totalOccurrences);
  const riskShare = percent(Number(topChain.risk_sum || 0), totalRisk);

  return (
    <article className="rootCauseInterpretation">
      <span>Root cause interpretation</span>
      <p>
        Le producteur <strong>{producer.label}</strong> est implique dans {producerShare}% des anomalies observees.
        L&apos;API <strong>{api.label}</strong> genere principalement des signaux <strong>{apiDominantAnomaly.label}</strong>.
        La chaine <strong>{topChain.producer_code} -&gt; {topChain.api_code} -&gt; {topChain.anomaly_type}</strong> represente {riskShare}% du risque global sur la periode analysee.
      </p>
      <dl>
        <div><dt>Top producer</dt><dd>{producer.label}</dd></div>
        <div><dt>Top API</dt><dd>{api.label}</dd></div>
        <div><dt>Dominant anomaly</dt><dd>{anomaly.label}</dd></div>
        <div><dt>Global risk contribution</dt><dd>{riskShare}%</dd></div>
      </dl>
    </article>
  );
}

function TopRootCauseChains({ chains, limit = 15 }: { chains: HistoricalRootCauseChain[]; limit?: number }) {
  return (
    <article className="historicalPanel rootCauseTablePanel">
      <div className="rootCauseTableTitle">
        <div>
          <span>CRITICAL PATHS</span>
          <h3>Top Root Cause Chains</h3>
        </div>
        <small>Sorted by average risk, then occurrences</small>
      </div>
      <div className="tableScroll">
        <table className="table rootCauseTable">
          <thead>
            <tr>
              <th>Producer</th>
              <th>API</th>
              <th>Anomaly</th>
              <th>Occurrences</th>
              <th>Average Risk</th>
              <th>Criticality</th>
            </tr>
          </thead>
          <tbody>
            {chains.slice(0, limit).map((chain) => (
              <tr key={`${chain.producer_code}-${chain.api_code}-${chain.anomaly_type}`}>
                <td><strong>{chain.producer_code}</strong></td>
                <td>{chain.api_code}</td>
                <td>
                  <span
                    className="rootCauseAnomalyBadge"
                    style={{ borderColor: familyColor(chain.anomaly_type) }}
                  >
                    {chain.anomaly_type}
                  </span>
                </td>
                <td>{chain.occurrences}</td>
                <td><strong>{formatRisk(Number(chain.average_risk_score || 0))}</strong></td>
                <td><span className={`rootCauseCriticality ${chain.criticality}`}>{chain.criticality}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function buildSankey(chains: HistoricalRootCauseChain[]) {
  const producerStats = aggregateNodeStats(chains, (chain) => chain.producer_code);
  const apiStats = aggregateNodeStats(chains, (chain) => chain.api_code);
  const anomalyStats = aggregateNodeStats(chains, (chain) => chain.anomaly_type);
  const columnCount = Math.max(producerStats.length, apiStats.length, anomalyStats.length);
  const height = Math.max(420, columnCount * 58 + 32);
  const nodes = [
    ...placeNodes(producerStats, "producer", height),
    ...placeNodes(apiStats, "api", height),
    ...placeNodes(anomalyStats, "anomaly", height),
  ];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const producerApi = aggregateLinks(chains, "producer", "api");
  const apiAnomaly = aggregateLinks(chains, "api", "anomaly");
  const links = [...producerApi, ...apiAnomaly].flatMap((item) => {
    const source = nodeMap.get(`${item.sourceKind}:${item.source}`);
    const target = nodeMap.get(`${item.targetKind}:${item.target}`);
    if (!source || !target) return [];
    return [{
      id: `${source.id}->${target.id}`,
      source,
      target,
      occurrences: item.occurrences,
      averageRisk: item.riskSum / Math.max(1, item.occurrences),
      color: item.targetKind === "anomaly" ? familyColor(item.target) : "#38bdf8",
    }];
  });
  return { nodes, links, height };
}

function aggregateNodeStats(
  chains: HistoricalRootCauseChain[],
  key: (chain: HistoricalRootCauseChain) => string,
) {
  const grouped = new Map<string, {
    label: string;
    total: number;
    riskSum: number;
    severitySum: number;
    anomalies: Map<string, number>;
    criticality: HistoricalRootCauseChain["criticality"];
  }>();
  chains.forEach((chain) => {
    const label = key(chain);
    const current = grouped.get(label) || {
      label,
      total: 0,
      riskSum: 0,
      severitySum: 0,
      anomalies: new Map<string, number>(),
      criticality: "low" as const,
    };
    current.total += chain.occurrences;
    current.riskSum += Number(chain.risk_sum || 0);
    current.severitySum += Number(chain.average_severity_score || 1) * chain.occurrences;
    current.anomalies.set(chain.anomaly_type, (current.anomalies.get(chain.anomaly_type) || 0) + chain.occurrences);
    if (criticalityRank(chain.criticality) > criticalityRank(current.criticality)) current.criticality = chain.criticality;
    grouped.set(label, current);
  });
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      averageRisk: item.riskSum / Math.max(1, item.total),
      averageSeverity: item.severitySum / Math.max(1, item.total),
      dominantAnomaly: [...item.anomalies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    }))
    .sort((left, right) => right.total - left.total);
}

function placeNodes(
  stats: ReturnType<typeof aggregateNodeStats>,
  kind: NodeKind,
  height: number,
): SankeyNode[] {
  const gap = Math.max(10, (height - stats.length * NODE_HEIGHT) / Math.max(1, stats.length + 1));
  return stats.map((item, index) => ({
    id: `${kind}:${item.label}`,
    label: item.label,
    kind,
    x: COLUMN_X[kind],
    y: gap + index * (NODE_HEIGHT + gap),
    total: item.total,
    averageRisk: item.averageRisk,
    averageSeverity: item.averageSeverity,
    dominantAnomaly: item.dominantAnomaly,
    criticality: item.criticality,
  }));
}

function aggregateLinks(
  chains: HistoricalRootCauseChain[],
  sourceKind: "producer" | "api",
  targetKind: "api" | "anomaly",
) {
  const grouped = new Map<string, { sourceKind: NodeKind; targetKind: NodeKind; source: string; target: string; occurrences: number; riskSum: number }>();
  chains.forEach((chain) => {
    const source = sourceKind === "producer" ? chain.producer_code : chain.api_code;
    const target = targetKind === "api" ? chain.api_code : chain.anomaly_type;
    const id = `${sourceKind}:${source}->${targetKind}:${target}`;
    const current = grouped.get(id) || { sourceKind, targetKind, source, target, occurrences: 0, riskSum: 0 };
    current.occurrences += chain.occurrences;
    current.riskSum += Number(chain.risk_sum || 0);
    grouped.set(id, current);
  });
  return [...grouped.values()];
}

function linkPath(link: SankeyLink) {
  const startX = link.source.x + NODE_WIDTH;
  const startY = link.source.y + NODE_HEIGHT / 2;
  const endX = link.target.x;
  const endY = link.target.y + NODE_HEIGHT / 2;
  const curve = (endX - startX) * 0.48;
  return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
}

function nodeColor(node: SankeyNode) {
  if (node.kind === "anomaly") return familyColor(node.label);
  if (node.kind === "api") return "#0f766e";
  return "#1e3a5f";
}

function nodeTooltip(node: SankeyNode) {
  const heading = node.kind === "producer"
    ? "Producer"
    : node.kind === "api"
      ? "API"
      : "Anomaly";
  const dominant = node.dominantAnomaly ? `\nDominant anomaly ${node.dominantAnomaly}` : "";
  const criticality = node.criticality ? `\nCriticality ${node.criticality}` : "";
  const averageSeverity = node.kind === "anomaly"
    ? `\nAverage severity ${severityLabel(node.averageSeverity)}`
    : "";
  return `${heading}: ${node.label}\n${node.total} anomalous calls\nAverage risk ${formatRisk(node.averageRisk)}${dominant}${averageSeverity}${criticality}`;
}

function familyColor(anomalyType: string) {
  return ANOMALY_FAMILY_COLORS[getAnomalyFamily(anomalyType)];
}

function topAggregate(
  chains: HistoricalRootCauseChain[],
  key: (chain: HistoricalRootCauseChain) => string,
) {
  const grouped = new Map<string, number>();
  chains.forEach((chain) => grouped.set(key(chain), (grouped.get(key(chain)) || 0) + chain.occurrences));
  const [label = "Not available", occurrences = 0] = [...grouped.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return { label, occurrences };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function formatRisk(value: number) {
  return `${Math.round(value)}/100`;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function criticalityRank(value: HistoricalRootCauseChain["criticality"]) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[value] || 0;
}

function severityLabel(value: number) {
  if (value >= 3.5) return "critical";
  if (value >= 2.5) return "high";
  if (value >= 1.5) return "medium";
  return "low";
}
