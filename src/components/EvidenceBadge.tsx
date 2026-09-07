import type { EvidenceStatus } from "../data";

const LABELS: Record<EvidenceStatus, string> = {
  observed: "Observed",
  "proxy-constrained": "Proxy constrained",
  "model-output": "Model output",
  interpolation: "Interpolated",
  synthesis: "Synthesis",
  "artistic-gap-fill": "Illustrative",
  unknown: "Uncertain",
};

const EXPLANATIONS: Record<EvidenceStatus, string> = {
  observed: "Directly observed or mapped evidence",
  "proxy-constrained": "Constrained by geological or palaeoclimate proxies",
  "model-output": "Generated from a documented scientific model",
  interpolation: "Interpolated between supported reconstruction states",
  synthesis: "A visual synthesis constrained by available evidence",
  "artistic-gap-fill": "Illustrative detail fills gaps in the record",
  unknown: "The evidence status is not yet resolved",
};

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  return (
    <span className={`evidence-badge evidence-${status}`} title={EXPLANATIONS[status]}>
      <span className="evidence-dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
