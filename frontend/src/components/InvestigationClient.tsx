"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type AiResult,
  type IncidentInterpretResult,
  type ValidationSummary,
  fetchAiResults,
  fetchAiWorkflowResults,
  fetchValidationSummary,
  generateDemoValidations,
  patchResultValidation,
  postIncidentInterpret,
} from "@/lib/api";
import { SeverityBadge } from "./SeverityBadge";

type CanonicalStatus =
  | "pending_review"
  | "auto_confirmed"
  | "auto_dismissed"
  | "confirmed"
  | "false_positive"
  | "resolved";

type TraceRecord = Record<string, unknown>;

const STATUS_ORDER: CanonicalStatus[] = [
  "pending_review",
  "auto_confirmed",
  "auto_dismissed",
  "confirmed",
  "false_positive",
  "resolved",
];

const DEFAULT_FILTERS = new Set<CanonicalStatus>(["pending_review"]);

const STATUS_LABELS: Record<CanonicalStatus, string> = {
  pending_review: "Pending Review",
  auto_confirmed: "Auto Confirmed",
  auto_dismissed: "Auto Dismissed",
  confirmed: "Human Confirmed",
  false_positive: "False Positive",
  resolved: "Resolved",
};

const ACTIONS: Array<{
  status: CanonicalStatus;
  label: string;
  className: string;
}> = [
  { status: "confirmed", label: "Confirm anomaly", className: "confirmed" },
  { status: "false_positive", label: "Mark false positive", className: "false-positive" },
  { status: "pending_review", label: "Needs investigation", className: "pending-review" },
  { status: "resolved", label: "Mark resolved", className: "resolved" },
];

export function InvestigationClient() {
  const [incidents, setIncidents] = useState<AiResult[]>([]);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [selected, setSelected] = useState<AiResult | null>(null);
  const [filters, setFilters] = useState<Set<CanonicalStatus>>(() => new Set(DEFAULT_FILTERS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryWarning, setSummaryWarning] = useState<string | null>(null);

  const [valComment, setValComment] = useState("");
  const [valBy, setValBy] = useState("supervisor");
  const [valSaving, setValSaving] = useState(false);
  const [valError, setValError] = useState<string | null>(null);
  const [valSuccess, setValSuccess] = useState<string | null>(null);

  const [aiResult, setAiResult] = useState<IncidentInterpretResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [demoLimit, setDemoLimit] = useState<20 | 50 | 100>(20);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [anomalyResult, workflowResult, summaryResult] = await Promise.allSettled([
        fetchAiResults(500),
        fetchAiWorkflowResults(200),
        fetchValidationSummary(),
    ]);

    try {
      if (anomalyResult.status === "rejected") {
        throw anomalyResult.reason;
      }
      const anomalyData = anomalyResult.value;
      const recentWorkflowData = workflowResult.status === "fulfilled" ? workflowResult.value : [];
      const incidentsData = Array.from(
        new Map(
          [
            ...anomalyData,
            ...recentWorkflowData.filter(
              (result) => canonicalStatus(result.validation_status) === "auto_dismissed",
            ),
          ].map((result) => [result.id, result]),
        ).values(),
      ).sort(
        (left, right) =>
          new Date(right.detected_at).getTime() - new Date(left.detected_at).getTime(),
      );
      setIncidents(incidentsData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Loading failed");
    }

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
      setSummaryWarning(null);
    } else {
      setSummaryWarning(
        summaryResult.reason instanceof Error
          ? summaryResult.reason.message
          : "Validation summary unavailable",
      );
    }

    if (workflowResult.status === "rejected" && anomalyResult.status === "fulfilled") {
      setSummaryWarning((current) =>
        current || "Auto-dismissed audit results are temporarily unavailable.",
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => {
    const values = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<CanonicalStatus, number>;
    incidents.forEach((incident) => {
      values[canonicalStatus(incident.validation_status)] += 1;
    });
    return values;
  }, [incidents]);

  const filteredIncidents = useMemo(
    () => incidents.filter((incident) => filters.has(canonicalStatus(incident.validation_status))),
    [filters, incidents],
  );

  function selectIncident(incident: AiResult) {
    setSelected(incident);
    setValComment(incident.validation_comment || "");
    setValBy(incident.validated_by || "supervisor");
    setValError(null);
    setValSuccess(null);
    setAiResult(null);
    setAiError(null);
  }

  function toggleFilter(status: CanonicalStatus) {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  async function handleValidate(status: CanonicalStatus) {
    if (!selected || valSaving) return;
    const currentStatus = canonicalStatus(selected.validation_status);
    if (!canTransition(currentStatus, status)) {
      setValError(transitionError(currentStatus, status));
      return;
    }
    setValSaving(true);
    setValError(null);
    setValSuccess(null);
    try {
      const updated = await patchResultValidation(
        selected.id,
        status,
        valComment.trim() || null,
        valBy.trim() || "supervisor",
      );
      setSelected(updated);
      setIncidents((current) => current.map((incident) => incident.id === updated.id ? updated : incident));
      setValSuccess(`Status updated: ${STATUS_LABELS[status]}.`);
      fetchValidationSummary().then(setSummary).catch(() => {});
    } catch (validationError) {
      setValError(validationError instanceof Error ? validationError.message : "Validation failed");
    } finally {
      setValSaving(false);
    }
  }

  async function handleAiAssist() {
    if (!selected || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      setAiResult(await postIncidentInterpret(selected.id));
    } catch (assistError) {
      setAiError(assistError instanceof Error ? assistError.message : "AI assistance failed");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleGenerateDemoValidations() {
    if (demoLoading) return;
    setDemoLoading(true);
    setDemoMessage(null);
    setDemoError(null);
    try {
      const result = await generateDemoValidations(demoLimit);
      setDemoMessage(
        `${result.updated} demo validations generated. RL learning ${result.include_demo_feedback ? "enabled" : "disabled"} for demo feedback.`,
      );
      await load();
      fetchValidationSummary().then(setSummary).catch(() => {});
    } catch (seedError) {
      setDemoError(seedError instanceof Error ? seedError.message : "Demo validation generation failed");
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <>
      <div className="pageHeader investigationPageHeader">
        <div>
          <span className="sectionEyebrow">Operational investigation</span>
          <h1>Investigations</h1>
          <p>Cette anomalie detectee par l&apos;IA est-elle reelle ?</p>
        </div>
        {summary && (
          <div className="validationSummaryBadges">
            <span className="vsBadge vsPending">{summary.pending_review + summary.partial + summary.unverified} pending</span>
            <span className="vsBadge vsAutoConfirmed">{summary.auto_confirmed || 0} auto confirmed</span>
            <span className="vsBadge vsAutoDismissed">{summary.auto_dismissed || 0} auto dismissed</span>
            <span className="vsBadge vsConfirmed">{summary.confirmed} human confirmed</span>
            <span className="vsBadge vsFp">{summary.false_positive} false positives</span>
            <span className="vsBadge vsResolved">{(summary.resolved || 0) + (summary.ignored || 0)} resolved</span>
          </div>
        )}
      </div>

      <section className="investigationFilters" aria-label="Investigation status filters">
        <button
          type="button"
          className={filters.size === STATUS_ORDER.length ? "active" : ""}
          onClick={() => setFilters(new Set(STATUS_ORDER))}
        >
          Tous <strong>{incidents.length}</strong>
        </button>
        {STATUS_ORDER.map((status) => (
          <button
            type="button"
            key={status}
            className={filters.has(status) ? "active" : ""}
            onClick={() => toggleFilter(status)}
          >
            {STATUS_LABELS[status]} <strong>{counts[status]}</strong>
          </button>
        ))}
      </section>

      <section className="demoValidationPanel" aria-label="Demo validation seeding">
        <div>
          <span className="sectionEyebrow">Admin / dev tool</span>
          <h2>Generate demo validations</h2>
          <p>
            Applies coherent simulated validations to recent pending AI anomalies.
            Results are marked as <strong>demo_seed</strong> by <strong>demo_supervisor</strong>.
          </p>
        </div>
        <div className="demoValidationControls">
          <select
            value={demoLimit}
            onChange={(event) => setDemoLimit(Number(event.target.value) as 20 | 50 | 100)}
            disabled={demoLoading}
          >
            <option value={20}>20 validations</option>
            <option value={50}>50 validations</option>
            <option value={100}>100 validations</option>
          </select>
          <button type="button" onClick={handleGenerateDemoValidations} disabled={demoLoading}>
            {demoLoading ? "Generating..." : "Generate demo validations"}
          </button>
        </div>
        {demoMessage && <div className="investigationSuccess">{demoMessage}</div>}
        {demoError && <div className="errorBox">{demoError}</div>}
      </section>

      {error && <div className="errorBox">Investigation data unavailable: {error}</div>}
      {summaryWarning && !error && (
        <div className="investigationWarning">
          Incident queue loaded. Some summary counters are temporarily unavailable.
        </div>
      )}
      {loading && !incidents.length && <div className="historicalLoading">Loading incident queue...</div>}

      <div className="investigationLayout">
        <aside className="investigationQueue">
          <div className="investigationQueueHeader">
            <strong>Incident Queue</strong>
            <span className="statusPill">{filteredIncidents.length} visibles</span>
          </div>

          {!filteredIncidents.length && !loading && (
            <p className="muted investigationEmpty">No anomaly matches the selected statuses.</p>
          )}

          <ul className="investigationList">
            {filteredIncidents.map((incident) => {
              const status = canonicalStatus(incident.validation_status);
              return (
                <li
                  key={incident.id}
                  className={`investigationQueueItem ${incident.severity} ${selected?.id === incident.id ? "selected" : ""}`}
                  onClick={() => selectIncident(incident)}
                >
                  <div className="iqiTop">
                    <span className="iqiType">{incident.detected_anomaly_type}</span>
                    <span className="iqiBadges">
                      {incident.validation_source === "demo_seed" && <span className="demoFeedbackBadge">Demo feedback</span>}
                      <SeverityBadge anomalyType={incident.detected_anomaly_type} severity={incident.severity} />
                    </span>
                  </div>
                  <div className="iqiMeta">
                    <span>{incident.flow_code || "flow unavailable"}</span>
                    <span className={`iqiStatus ${status.replace("_", "-")}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                  <small className="iqiDate">{formatDate(incident.detected_at)}</small>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="investigationDetail">
          {!selected ? (
            <div className="investigationPlaceholder">
              <span className="investigationPlaceholderArrow">&larr;</span>
              <p>Select an incident from the queue to begin investigation.</p>
            </div>
          ) : (
            <InvestigationDetail
              selected={selected}
              valBy={valBy}
              valComment={valComment}
              valSaving={valSaving}
              valError={valError}
              valSuccess={valSuccess}
              aiResult={aiResult}
              aiLoading={aiLoading}
              aiError={aiError}
              onValByChange={setValBy}
              onValCommentChange={setValComment}
              onValidate={handleValidate}
              onAiAssist={handleAiAssist}
            />
          )}
        </section>
      </div>
    </>
  );
}

function InvestigationDetail({
  selected,
  valBy,
  valComment,
  valSaving,
  valError,
  valSuccess,
  aiResult,
  aiLoading,
  aiError,
  onValByChange,
  onValCommentChange,
  onValidate,
  onAiAssist,
}: {
  selected: AiResult;
  valBy: string;
  valComment: string;
  valSaving: boolean;
  valError: string | null;
  valSuccess: string | null;
  aiResult: IncidentInterpretResult | null;
  aiLoading: boolean;
  aiError: string | null;
  onValByChange: (value: string) => void;
  onValCommentChange: (value: string) => void;
  onValidate: (status: CanonicalStatus) => void;
  onAiAssist: () => void;
}) {
  const metadata = asRecord(selected.metadata);
  const analysisTrace = asRecord(metadata.analysis_trace);
  const eventTrace = asRecord(analysisTrace.event);
  const flowTrace = asRecord(analysisTrace.flow);
  const temporalTrace = asRecord(analysisTrace.temporal);
  const graphTrace = asRecord(analysisTrace.graph);
  const riskFusion = asRecord(metadata.risk_fusion);
  const riskContributions = asRecord(riskFusion.contributions);
  const triageDecision = asRecord(metadata.triage_decision);
  const triageSignals = asRecord(triageDecision.signals);
  const detector = selectDetector(metadata, eventTrace, flowTrace, temporalTrace, graphTrace);
  const currentStatus = canonicalStatus(selected.validation_status);

  return (
    <>
      <InvestigationSection title="Informations evenement">
        <div className="investigationKvGrid investigationKvDense">
          <Info label="Event ID" value={selected.source_event_id || selected.id} />
          <Info label="Source" value={selected.source_event_type} />
          <Info label="Flow" value={selected.flow_code || textValue(metadata.flow_code)} />
          <Info label="API" value={textValue(metadata.api_code)} />
          <Info label="Consumer" value={textValue(metadata.consumer_code)} />
          <Info label="Producer" value={textValue(metadata.producer_code)} />
          <Info label="Detected at" value={formatDate(selected.detected_at)} />
          <Info label="Analysis type" value={selected.analysis_type} />
        </div>
      </InvestigationSection>

      <InvestigationSection title="Resultat IA">
        <div className="investigationCardTop">
          <div>
            <h3 className="incidentTypeName">{selected.detected_anomaly_type}</h3>
            <p className="incidentMeta">
              Risk <strong>{selected.risk_score}/100</strong> / confidence <strong>{formatConfidence(selected.confidence)}</strong>
            </p>
            {selected.validation_source === "demo_seed" && (
              <span className="demoFeedbackBadge detail">Demo feedback</span>
            )}
          </div>
          <SeverityBadge anomalyType={selected.detected_anomaly_type} severity={selected.severity} />
        </div>
        <div className="investigationKvGrid">
          <Info label="Explanation" value={selected.explanation} wide />
          <Info label="Recommendation" value={selected.recommendation} wide strong />
        </div>
      </InvestigationSection>

      <InvestigationSection title="Detecteur IA">
        <div className={`investigationDetector ${selected.severity}`}>
          <div>
            <span>{detector.level}</span>
            <h3>{detector.name}</h3>
            <small>{detector.id}{detector.version ? ` / ${detector.version}` : ""}</small>
          </div>
          <dl>
            <div><dt>Anomaly</dt><dd>{textValue(detector.trace.anomaly_type)}</dd></div>
            <div><dt>Confidence</dt><dd>{formatConfidence(numberValue(detector.trace.confidence))}</dd></div>
            <div><dt>Risk contribution</dt><dd>{numberValue(detector.trace.risk_contribution) ?? "unavailable"}</dd></div>
            <div><dt>Decision</dt><dd>{textValue(detector.trace.decision_next_level)}</dd></div>
            <div className="detectorReason"><dt>Decision reason</dt><dd>{textValue(detector.trace.decision_reason)}</dd></div>
          </dl>
        </div>
      </InvestigationSection>

      <div className="investigationTraceGrid">
        <TracePanel title="Event-Level trace" trace={eventTrace} />
        <TracePanel title="Flow-Level trace" trace={flowTrace} />
        <TracePanel title="Temporal-Level trace" trace={temporalTrace} />
        <TracePanel title="Graph-Level trace" trace={graphTrace} />
      </div>

      <InvestigationSection title="Risk Fusion">
        <div className="investigationKvGrid investigationKvDense">
          <Info label="Status" value={textValue(riskFusion.status)} />
          <Info label="Final risk" value={riskFusion.final_risk_score != null ? `${riskFusion.final_risk_score}/100` : null} />
          <Info label="Final severity" value={textValue(riskFusion.final_severity)} />
          <Info label="Event contribution" value={numberValue(riskContributions.event)?.toString()} />
          <Info label="Flow contribution" value={numberValue(riskContributions.flow)?.toString()} />
          <Info label="Temporal contribution" value={numberValue(riskContributions.temporal)?.toString()} />
          <Info label="Graph contribution" value={numberValue(riskContributions.graph)?.toString()} />
          <Info label="Executed levels" value={arrayValue(riskFusion.executed_levels)} />
          <Info label="Skipped levels" value={arrayValue(riskFusion.skipped_levels)} />
          <Info label="Reason" value={textValue(riskFusion.fusion_reason)} wide />
        </div>
      </InvestigationSection>

      <InvestigationSection title="Triage Decision">
        {Object.keys(triageDecision).length ? (
          <>
            <div className={`triageDecisionBanner ${currentStatus.replace("_", "-")}`}>
              <div>
                <span>Automatic triage</span>
                <strong>{textValue(triageDecision.status)}</strong>
              </div>
              <span className="triageReviewFlag">
                {triageDecision.requires_human_review === true ? "Human review required" : "No human review required"}
              </span>
            </div>
            <div className="investigationKvGrid investigationKvDense">
              <Info label="Review policy" value={textValue(triageDecision.review_policy)} />
              <Info label="Policy version" value={textValue(triageDecision.policy_version || triageDecision.policy)} />
              <Info label="Reason" value={textValue(triageDecision.reason)} wide />
              <Info label="Anomaly family" value={textValue(triageSignals.family)} />
              <Info label="Risk score" value={numberValue(triageSignals.risk_score)?.toString()} />
              <Info label="Confidence" value={formatConfidence(numberValue(triageSignals.confidence))} />
              <Info label="Severity" value={textValue(triageSignals.severity)} />
              <Info label="Event anomaly" value={booleanValue(triageSignals.event_anomaly)} />
              <Info label="Flow anomaly" value={booleanValue(triageSignals.flow_anomaly)} />
              <Info label="Multi-level agreement" value={booleanValue(triageSignals.multi_level_agreement)} />
              <Info
                label="Repeated occurrences"
                value={
                  numberValue(triageSignals.repeated_occurrences)?.toString()
                  || "Not available"
                }
              />
            </div>
          </>
        ) : (
          <p className="muted">Triage decision unavailable for this legacy result.</p>
        )}
      </InvestigationSection>

      <InvestigationSection title="RL Decision Agent">
        {Object.keys(triageDecision).length ? (
          <div className="investigationKvGrid investigationKvDense">
            <Info
              label="Final decision source"
              value={textValue(triageDecision.source || "baseline")}
            />
            <Info
              label="Baseline decision"
              value={textValue(triageDecision.baseline_status || triageDecision.status)}
            />
            <Info
              label="RL action"
              value={triageDecision.rl_action ? textValue(triageDecision.rl_action) : "RL disabled or not applied"}
            />
            <Info
              label="RL confidence"
              value={formatConfidence(numberValue(triageDecision.rl_confidence))}
            />
            <Info
              label="Expected reward"
              value={
                numberValue(triageDecision.expected_reward) == null
                  ? "Not available"
                  : numberValue(triageDecision.expected_reward)?.toFixed(2)
              }
            />
            <Info
              label="Policy version"
              value={textValue(triageDecision.policy_version || triageDecision.policy)}
            />
            <Info
              label="RL policy version"
              value={textValue(triageDecision.rl_policy_version)}
            />
            <Info
              label="Safety override"
              value={booleanValue(triageDecision.safety_override)}
            />
            <Info
              label="Reason"
              value={
                triageDecision.rl_action
                  ? textValue(triageDecision.reason)
                  : "RL Decision Agent disabled. Baseline triage policy is used."
              }
              wide
            />
          </div>
        ) : (
          <p className="muted">RL Decision Agent unavailable for this legacy result.</p>
        )}
      </InvestigationSection>

      <InvestigationSection title="Investigation Timeline">
        <InvestigationTimeline
          selected={selected}
          eventTrace={eventTrace}
          flowTrace={flowTrace}
          temporalTrace={temporalTrace}
          graphTrace={graphTrace}
          riskFusion={riskFusion}
        />
      </InvestigationSection>

      <InvestigationSection title="Validation humaine">
        <div className="validationLifecycle">
          <span className={currentStatus === "pending_review" ? "active" : lifecycleReached(currentStatus, "pending_review") ? "done" : ""}>PENDING REVIEW</span>
          <i />
          <div className="validationDecisionBranch">
            <span className={currentStatus === "confirmed" ? "active" : currentStatus === "resolved" ? "done" : ""}>CONFIRMED</span>
            <span className={currentStatus === "false_positive" ? "active falsePositive" : ""}>FALSE POSITIVE</span>
          </div>
          <i />
          <span className={currentStatus === "resolved" ? "active" : ""}>RESOLVED</span>
        </div>
        <div className="validationActions">
          {ACTIONS.map((action) => (
            <button
              key={action.status}
              type="button"
              className={`validationBtn valBtn-${action.className}`}
              disabled={valSaving || !canTransition(currentStatus, action.status)}
              onClick={() => onValidate(action.status)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="validationForm">
          <label className="validationLabel">
            Validation comment
            <textarea
              className="validationTextarea"
              placeholder="Observation and decision rationale..."
              value={valComment}
              onChange={(event) => onValCommentChange(event.target.value)}
              rows={3}
            />
          </label>
          <label className="validationLabel">
            Validated by
            <input
              className="input"
              value={valBy}
              onChange={(event) => onValByChange(event.target.value)}
              placeholder="Supervisor name"
            />
          </label>
        </div>
        {valError && <p className="insightError validationMsg">{valError}</p>}
        {valSuccess && <p className="validationSuccess validationMsg">{valSuccess}</p>}
        {selected.validated_at && (
          <p className="investigationAuditLine">
            Last validation: {formatDate(selected.validated_at)} by {selected.validated_by || "unavailable"}
          </p>
        )}
      </InvestigationSection>

      <InvestigationSection title="Incident AI Assistant">
        <p className="investigationAiIntro">
          Explain the selected incident using its stored AI result and analysis trace.
        </p>
        <button type="button" className="button primary" disabled={aiLoading} onClick={onAiAssist}>
          {aiLoading ? "Explaining..." : "Explain incident"}
        </button>
        {aiError && <p className="insightError validationMsg">{aiError}</p>}
        {aiResult && !aiResult.configured && (
          <p className="muted validationMsg">{aiResult.message || "AI assistance is not configured."}</p>
        )}
        {aiResult?.configured && <IncidentAiResult result={aiResult} />}
      </InvestigationSection>
    </>
  );
}

function InvestigationSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="investigationSection">
      <h2 className="investigationSectionTitle">{title}</h2>
      <div className="investigationCard">{children}</div>
    </div>
  );
}

function TracePanel({ title, trace }: { title: string; trace: TraceRecord }) {
  const available = Object.keys(trace).length > 0;
  return (
    <article className="investigationCard investigationTracePanel">
      <div className="investigationTraceHeader">
        <h3>{title}</h3>
        <span className={`traceStatus ${available ? textValue(trace.status).toLowerCase() : "unavailable"}`}>
          {available ? textValue(trace.status) : "unavailable"}
        </span>
      </div>
      {!available ? (
        <p className="muted">Analysis trace unavailable for this legacy result.</p>
      ) : (
        <div className="investigationKvGrid investigationKvDense">
          <Info label="Executed" value={booleanValue(trace.executed)} />
          <Info label="Selected model" value={textValue(trace.selected_model_name || trace.selected_model_id)} />
          <Info label="Version" value={textValue(trace.selected_model_version)} />
          <Info label="Anomaly" value={textValue(trace.anomaly_type)} />
          <Info label="Confidence" value={formatConfidence(numberValue(trace.confidence))} />
          <Info label="Risk contribution" value={numberValue(trace.risk_contribution)?.toString()} />
          <Info label="Next level" value={textValue(trace.decision_next_level)} />
          <Info label="Decision reason" value={textValue(trace.decision_reason || trace.skip_reason || trace.reason)} wide />
        </div>
      )}
    </article>
  );
}

function InvestigationTimeline({
  selected,
  eventTrace,
  flowTrace,
  temporalTrace,
  graphTrace,
  riskFusion,
}: {
  selected: AiResult;
  eventTrace: TraceRecord;
  flowTrace: TraceRecord;
  temporalTrace: TraceRecord;
  graphTrace: TraceRecord;
  riskFusion: TraceRecord;
}) {
  const status = canonicalStatus(selected.validation_status);
  const steps = [
    timelineStep("Event received", "success", selected.created_at || selected.detected_at, selected.source_event_type),
    timelineStep("Event-Level", traceStatus(eventTrace), traceTimestamp(eventTrace), traceMessage(eventTrace)),
    timelineStep("Flow-Level", traceStatus(flowTrace), traceTimestamp(flowTrace), traceMessage(flowTrace)),
    timelineStep("Temporal-Level", traceStatus(temporalTrace), traceTimestamp(temporalTrace), traceMessage(temporalTrace)),
    timelineStep("Graph-Level", traceStatus(graphTrace), traceTimestamp(graphTrace), traceMessage(graphTrace)),
    timelineStep("Risk Fusion", traceStatus(riskFusion), traceTimestamp(riskFusion), textValue(riskFusion.fusion_reason)),
    timelineStep(
      "Recommendation",
      selected.recommendation ? "success" : "unavailable",
      null,
      selected.recommendation || "Recommendation unavailable",
    ),
    timelineStep(
      "Human validation",
      status === "pending_review"
        ? "warning"
        : status === "auto_confirmed" || status === "auto_dismissed"
          ? "skipped"
          : "success",
      selected.validated_at ?? null,
      status === "auto_confirmed" || status === "auto_dismissed"
        ? `${STATUS_LABELS[status]} by automatic triage`
        : STATUS_LABELS[status],
    ),
    timelineStep(
      "Resolution",
      status === "resolved" ? "success" : status === "false_positive" ? "skipped" : "pending",
      status === "resolved" ? selected.validated_at ?? null : null,
      status === "resolved"
        ? "Incident closed by supervisor"
        : status === "false_positive"
          ? "Not applicable after false-positive validation"
          : "Resolution pending",
    ),
  ];

  return (
    <ol className="investigationProcessTimeline">
      {steps.map((step) => (
        <li key={step.name} className={step.status}>
          <i />
          <div>
            <strong>{step.name}</strong>
            <span>{step.message}</span>
            <small>{step.timestamp ? formatDate(step.timestamp) : "timestamp unavailable"}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function IncidentAiResult({ result }: { result: IncidentInterpretResult }) {
  return (
    <div className="aiAssistResult">
      <div className="aiAssistDiagnosis">
        <span className="insightSectionLabel">Diagnosis</span>
        <p>{result.diagnosis}</p>
        {result.is_likely_real != null && (
          <span className={`aiRealBadge ${result.is_likely_real ? "aiReal" : "aiFp"}`}>
            {result.is_likely_real ? "Likely real anomaly" : "Likely false positive"}
            {result.confidence && ` / confidence ${result.confidence}`}
          </span>
        )}
      </div>
      {result.risk_assessment && (
        <div className="aiAssistBlock">
          <span className="insightSectionLabel">Risk assessment</span>
          <p>{result.risk_assessment}</p>
        </div>
      )}
      {(result.action_plan || []).length > 0 && (
        <div className="aiAssistBlock">
          <span className="insightSectionLabel">Action plan</span>
          <ul className="insightList">
            {(result.action_plan || []).map((action, index) => <li key={index}>{action}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  wide = false,
  strong = false,
}: {
  label: string;
  value: unknown;
  wide?: boolean;
  strong?: boolean;
}) {
  const display = displayValue(value);
  return (
    <div className={`kv ${wide ? "investigationKvWide" : ""}`}>
      <span>{label}</span>
      {strong ? <strong>{display}</strong> : <span>{display}</span>}
    </div>
  );
}

function selectDetector(
  metadata: TraceRecord,
  eventTrace: TraceRecord,
  flowTrace: TraceRecord,
  temporalTrace: TraceRecord,
  graphTrace: TraceRecord,
) {
  const candidates = [
    { level: "GRAPH_LEVEL", trace: graphTrace },
    { level: "TEMPORAL_LEVEL", trace: temporalTrace },
    { level: "FLOW_LEVEL", trace: flowTrace },
    { level: "EVENT_LEVEL", trace: eventTrace },
  ];
  const selected = candidates.find((candidate) =>
    candidate.trace.executed === true && candidate.trace.anomaly_detected === true,
  ) || candidates[candidates.length - 1];
  const trace = selected.trace;
  const model = asRecord(metadata.model);
  return {
    trace,
    level: selected.level,
    id: textValue(trace.selected_model_id || metadata.model_id || model.id),
    name: textValue(trace.selected_model_name || model.name || trace.selected_model_id || metadata.model_id),
    version: nullableText(trace.selected_model_version || model.version),
  };
}

function canonicalStatus(value: string | null | undefined): CanonicalStatus {
  const status = String(value || "unverified").toLowerCase();
  if (status === "unverified" || status === "partial" || status === "needs_investigation") return "pending_review";
  if (status === "ignored") return "resolved";
  if (STATUS_ORDER.includes(status as CanonicalStatus)) return status as CanonicalStatus;
  return "pending_review";
}

function lifecycleReached(current: CanonicalStatus, target: CanonicalStatus) {
  if (current === "auto_confirmed" || current === "auto_dismissed") return false;
  if (current === "false_positive") return target === "pending_review";
  return STATUS_ORDER.indexOf(current) >= STATUS_ORDER.indexOf(target);
}

function canTransition(current: CanonicalStatus, target: CanonicalStatus) {
  if (target === "pending_review") return current === "pending_review";
  if (target === "confirmed" || target === "false_positive") return current === "pending_review";
  if (target === "resolved") return current === "confirmed";
  return false;
}

function transitionError(current: CanonicalStatus, target: CanonicalStatus) {
  if (target === "confirmed" || target === "false_positive") {
    return "Move the anomaly to Needs investigation before making the final validation decision.";
  }
  if (target === "resolved") {
    return "Only a confirmed anomaly can be marked as resolved.";
  }
  return `Transition from ${STATUS_LABELS[current]} to ${STATUS_LABELS[target]} is not allowed.`;
}

function asRecord(value: unknown): TraceRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as TraceRecord : {};
}

function textValue(value: unknown) {
  return nullableText(value) || "unavailable";
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? (value ? "yes" : "no") : "unavailable";
}

function arrayValue(value: unknown) {
  return Array.isArray(value) && value.length ? value.join(", ") : "unavailable";
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "unavailable";
  return String(value);
}

function formatConfidence(value: unknown) {
  const confidence = numberValue(value);
  if (confidence === null) return "unavailable";
  return confidence <= 1 ? `${Math.round(confidence * 100)}%` : `${Math.round(confidence)}%`;
}

function traceStatus(trace: TraceRecord) {
  if (!Object.keys(trace).length) return "unavailable";
  return textValue(trace.status).toLowerCase();
}

function traceTimestamp(trace: TraceRecord) {
  return nullableText(trace.timestamp || trace.completed_at || trace.detected_at);
}

function traceMessage(trace: TraceRecord) {
  return textValue(
    trace.decision_reason
    || trace.skip_reason
    || trace.reason
    || trace.anomaly_type,
  );
}

function timelineStep(name: string, status: string, timestamp: string | null, message: string) {
  return { name, status, timestamp, message };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "timestamp unavailable";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
