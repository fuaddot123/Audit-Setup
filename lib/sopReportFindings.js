import { getCatsForRecord, isCriticalItem, temuanText } from "./sopConfig.js";

// Only an explicit failed answer is a submitted finding. Missing answers are
// not silently turned into findings when an older checklist has fewer items.
export function submittedSopFindings(record) {
  if (!record || typeof record !== "object") return [];
  const checks = record.checks || {};
  const notes = record.notes || {};
  const findings = [];

  getCatsForRecord(record).forEach((cat) => {
    cat.items.forEach((item, index) => {
      const key = `${cat.id}_${index}`;
      if (checks[key] !== false) return;
      findings.push({
        key,
        category: cat.label,
        text: temuanText(cat.id, index, item),
        checklistItem: item,
        note: typeof notes[key] === "string" ? notes[key].trim() : "",
        markedCritical: isCriticalItem(cat.id, index),
      });
    });
  });

  return findings;
}

export function confirmedCriticalFindings(candidates, selected) {
  if (!Array.isArray(selected)) throw new Error("Invalid AI selection");
  const byId = new Map(candidates.map((finding) => [finding.id, finding]));
  const seen = new Set();
  return selected.flatMap((item) => {
    const source = byId.get(item?.id);
    if (!source || seen.has(item.id) ||
        !["SOP", "Operasional", "SOP dan Operasional"].includes(item.impact)) return [];
    seen.add(item.id);
    return [{
      recordId: source.recordId,
      key: source.key,
      impact: item.impact,
      reason: String(item.reason || "").slice(0, 300),
      action: String(item.action || "").slice(0, 300),
    }];
  });
}
