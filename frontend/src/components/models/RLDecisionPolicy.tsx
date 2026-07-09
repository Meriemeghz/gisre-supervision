"use client";

import { useEffect, useState } from "react";
import { getRLPolicyStatus, type RLPolicyStatus } from "@/lib/api/ai-models";

export function RLDecisionPolicy() {
  const [status, setStatus] = useState<RLPolicyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getRLPolicyStatus()
      .then((payload) => {
        if (!active) return;
        setStatus(payload);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "RL policy status unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <section className="card cardBody">Loading RL decision policy...</section>;
  if (error) return <section className="errorBox">RL policy unavailable: {error}</section>;
  if (!status) return null;

  const distribution = Object.entries(status.decision_distribution || {});
  return (
    <section className="card rlPolicyPanel">
      <div className="cardHeader">
        <div>
          <span className="sectionEyebrow">Reinforcement Learning / Decision Policy</span>
          <h2>RL Decision Agent</h2>
          <p>
            RL optimizes triage decisions after Risk Fusion. It does not detect anomalies and does not retrain Event,
            Flow or Temporal models.
          </p>
        </div>
        <span className={`statusPill ${status.enabled ? "stream-live" : "stream-error"}`}>
          {status.enabled ? "enabled" : "disabled"}
        </span>
      </div>
      <div className="cardBody">
        {!status.enabled && (
          <div className="triageDecisionBanner auto-dismissed">
            <div>
              <span>Runtime mode</span>
              <strong>RL Decision Agent disabled</strong>
            </div>
            <span className="triageReviewFlag">Baseline triage policy is used.</span>
          </div>
        )}

        <div className="modelMetricGrid rlPolicyKpis">
          <Metric label="Algorithm" value={status.algorithm} />
          <Metric label="Policy version" value={status.policy_version} />
          <Metric label="Total experiences" value={status.total_experiences.toString()} />
          <Metric label="Average reward" value={formatNumber(status.average_reward)} />
          <Metric label="Cumulative reward" value={formatNumber(status.cumulative_reward)} />
          <Metric label="Human override rate" value={`${Math.round((status.human_override_rate || 0) * 100)}%`} />
          <Metric label="Last policy update" value={status.last_policy_update || "Not available"} />
        </div>

        <div className="rlPolicyGrid">
          <article className="rulesAuditPanel">
            <div className="rulesAuditHeader">
              <div>
                <span className="sectionEyebrow">Decision distribution</span>
                <h3>Actions learned from validation</h3>
              </div>
            </div>
            {!distribution.length ? (
              <p className="muted">No RL experience recorded yet.</p>
            ) : (
              <div className="chartBars">
                {distribution.map(([action, count]) => (
                  <div className="chartBarRow" key={action}>
                    <span>{action}</span>
                    <div className="chartBarTrack">
                      <div
                        className="chartBarFill"
                        style={{ width: `${Math.max(6, (count / Math.max(...distribution.map(([, value]) => value), 1)) * 100)}%` }}
                      />
                    </div>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rulesAuditPanel">
            <div className="rulesAuditHeader">
              <div>
                <span className="sectionEyebrow">Top contexts learned</span>
                <h3>Contextual bandit policy</h3>
              </div>
            </div>
            {!status.top_contexts_learned?.length ? (
              <p className="muted">No learned context available yet.</p>
            ) : (
              <div className="tableScroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Context</th>
                      <th>Experiences</th>
                      <th>Best action</th>
                      <th>Avg reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.top_contexts_learned.map((context) => (
                      <tr key={context.context}>
                        <td>{context.context}</td>
                        <td>{context.total_experiences}</td>
                        <td>{context.best_action || "Not available"}</td>
                        <td>{context.best_average_reward == null ? "N/A" : formatNumber(context.best_average_reward)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metricBox">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
