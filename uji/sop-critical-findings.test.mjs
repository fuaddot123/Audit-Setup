import assert from "node:assert/strict";
import test from "node:test";
import { confirmedCriticalFindings, submittedSopFindings } from "../lib/sopReportFindings.js";

test("only explicitly failed checklist answers become findings", () => {
  const record = {
    cats: { display_laptop: { score: 0, total: 0 } },
    checks: { gudang_8: false, display_aksesoris_1: false, kasir_2: true },
    notes: { gudang_8: "Selisih stok 2 unit" },
  };
  const findings = submittedSopFindings(record);
  assert.deepEqual(findings.map((finding) => finding.key), ["display_aksesoris_1", "gudang_8"]);
  assert.equal(findings[1].markedCritical, true);
  assert.equal(findings[1].note, "Selisih stok 2 unit");
});

test("AI output cannot add an invented finding or duplicate a submitted one", () => {
  const candidates = [{ id: "f1", recordId: "audit-1", key: "gudang_8" }];
  const selected = [
    { id: "f1", impact: "SOP dan Operasional", reason: "Selisih stok", action: "Rekonsiliasi" },
    { id: "f1", impact: "SOP", reason: "Duplikat", action: "Abaikan" },
    { id: "f2", impact: "SOP", reason: "Temuan baru", action: "Abaikan" },
  ];
  assert.deepEqual(confirmedCriticalFindings(candidates, selected), [{
    recordId: "audit-1", key: "gudang_8", impact: "SOP dan Operasional",
    reason: "Selisih stok", action: "Rekonsiliasi",
  }]);
});
