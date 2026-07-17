import { useState, useRef, useEffect } from "react";

// branches: [{id, name}], selectedIds: array id (null/undefined = semua cabang)
export default function BranchMultiSelect({ branches, selectedIds, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const allSelected = !selectedIds || selectedIds.length === branches.length;
  const label = allSelected ? "Semua Cabang" : selectedIds.length === 0 ? "Pilih cabang\u2026" : `${selectedIds.length} cabang dipilih`;

  function toggleBranch(id) {
    const current = allSelected ? branches.map((b) => b.id) : [...selectedIds];
    const idx = current.indexOf(id);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(id);
    onChange(current);
  }

  function selectAll() { onChange(branches.map((b) => b.id)); }
  function selectNone() { onChange([]); }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="input" onClick={() => setOpen((v) => !v)} style={{ width: 220, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        <span style={{ fontSize: 11, color: "var(--text-faint)", transform: open ? "rotate(180deg)" : "none" }}>&#9660;</span>
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, width: 240, maxHeight: 320, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
          <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)" }}>
            <button type="button" onClick={selectAll} style={{ fontSize: 11, color: "#F4B740", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Pilih semua</button>
            <span style={{ color: "var(--text-faint)", fontSize: 11 }}>&middot;</span>
            <button type="button" onClick={selectNone} style={{ fontSize: 11, color: "var(--text-faint)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Kosongkan</button>
          </div>
          <div style={{ padding: "4px 4px" }}>
            {branches.map((b) => {
              const checked = allSelected || selectedIds.includes(b.id);
              return (
                <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 12.5, cursor: "pointer", borderRadius: 6 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleBranch(b.id)} />
                  {b.name}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
