// ============================================================
// TEMPLATE LAPORAN PDF — dipakai bareng semua modul (SOP, Service, Stok, KPI, dst)
// Meniru gaya "Laporan Audit Kas Kecil": header ungu-emas, kartu ringkasan,
// tabel data, donut chart distribusi, keterangan indikator, footer.
// ============================================================

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const ICONS = {
  building: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1"/></svg>`,
  shieldCheck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>`,
  alertCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`,
  alertTriangle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5M12 17h.01"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="12" height="17" rx="1.5"/><rect x="9" y="2.5" width="6" height="3" rx="1"/><path d="M9 11h6M9 15h6"/></svg>`,
  arrowDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v13M6 13l6 5 6-5"/></svg>`,
  arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V6M6 11l6-5 6 5"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M17 12h2M3 10h18"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18 14 14 0 010-18z"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>`,
};

function donutSvg(segments, centerLines) {
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  const r = 42, cx = 50, cy = 50, circumf = 2 * Math.PI * r;
  let offset = 0;
  const circles = segments.map((seg) => {
    const frac = seg.count / total;
    const len = frac * circumf;
    const dash = `${len} ${circumf - len}`;
    const rotate = (offset / total) * 360 - 90;
    offset += seg.count;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="14" stroke-dasharray="${dash}" transform="rotate(${rotate} ${cx} ${cy})" />`;
  }).join("");
  return `<svg viewBox="0 0 100 100" width="150" height="150">${circles}
    <text x="50" y="46" text-anchor="middle" font-size="17" font-weight="800" fill="#2A1F52" font-family="Arial">${esc(centerLines[0])}</text>
    <text x="50" y="60" text-anchor="middle" font-size="8" fill="#888" font-family="Arial">${esc(centerLines[1])}</text>
  </svg>`;
}

// opts = {
//   reportTitle, scopeLabel, periodLabel, printedAtLabel,
//   summaryCards: [{icon,label,value,sub,color}],           // pertama = total (ungu), lainnya bebas
//   tableHeaders: [string],
//   tableRows: [{cells:[string], badge:{label,color}|null}],
//   donutSegments: [{label,count,color}], donutCenterLines: [line1,line2],
//   legendItems: [{icon,color,title,desc}],
//   summaryList: [{icon,label,value,strong}],                 // kolom "Ringkasan"
//   notes: [string],
//   pageLabel: "Halaman 1 dari 1",
// }
export function buildSummaryReportHtml(opts) {
  const {
    reportTitle, scopeLabel, periodLabel, printedAtLabel,
    summaryCards = [], tableHeaders = [], tableRows = [],
    donutSegments = [], donutCenterLines = ["0", "Cabang"],
    legendItems = [], summaryList = [], notes = [], pageLabel = "Halaman 1 dari 1",
  } = opts;

  const cardsHtml = summaryCards.map((c, i) => `
    <div class="scard">
      <div class="scard-icon" style="background:${c.color}22;color:${c.color}">${ICONS[c.icon] || ICONS.building}</div>
      <div>
        <div class="scard-label" style="color:${i === 0 ? "#2A1F52" : c.color}">${esc(c.label)}</div>
        <div class="scard-value">${esc(c.value)}</div>
        <div class="scard-sub">${esc(c.sub || "")}</div>
      </div>
    </div>`).join("");

  const theadHtml = `<tr>${tableHeaders.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const tbodyHtml = tableRows.map((r) => {
    const cells = r.cells.map((c, i) => {
      if (i === r.cells.length - 1 && r.badge) {
        return `<td><span class="badge" style="background:${r.badge.color}18;color:${r.badge.color}">${esc(r.badge.label)}</span></td>`;
      }
      const empty = c === null || c === undefined || c === "";
      return `<td${empty ? ' class="empty"' : ""}>${empty ? "Belum diisi" : esc(c)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  const legendDotsHtml = donutSegments.map((s) => `
    <div class="legend-row">
      <span class="dot" style="background:${s.color}"></span>
      <span class="legend-label">${esc(s.label)}</span>
      <span class="legend-count">${s.count} (${s.pct}%)</span>
    </div>`).join("");

  const legendItemsHtml = legendItems.map((l) => `
    <div class="li-item">
      <div class="li-icon" style="background:${l.color}22;color:${l.color}">${ICONS[l.icon] || ICONS.shieldCheck}</div>
      <div>
        <div class="li-title" style="color:${l.color}">${esc(l.title)}</div>
        <div class="li-desc">${esc(l.desc)}</div>
      </div>
    </div>`).join("");

  const summaryListHtml = summaryList.map((s, i) => `
    <div class="sl-row ${s.strong ? "sl-strong" : ""}">
      <div class="sl-icon">${ICONS[s.icon] || ICONS.wallet}</div>
      <div class="sl-label">${esc(s.label)}</div>
      <div class="sl-value">${esc(s.value)}</div>
    </div>`).join("");

  const notesHtml = notes.map((n) => `<li>${esc(n)}</li>`).join("");

  return `<div class="page">
    <div class="rhdr">
      <div class="rhdr-left">
        <div class="rhdr-badge">${ICONS.shieldCheck}</div>
        <div>
          <div class="rhdr-title">AUDIT INTERNAL</div>
          <div class="rhdr-sub">KLA TEKNOLOGI INDONESIA</div>
        </div>
      </div>
      <div class="rhdr-right">
        <div class="rhdr-icon">${ICONS.calendar}</div>
        <div>
          <div class="rhdr-date">${esc(printedAtLabel)}</div>
          <div class="rhdr-by">Dicetak Oleh: Sistem Audit</div>
        </div>
      </div>
    </div>
    <div class="rhdr-bar"></div>

    <div class="rbody">
      <div class="rtitle">${esc(reportTitle)}</div>
      <div class="rscope">${esc(scopeLabel)}</div>
      <div class="rscope-line"></div>

      <div class="rinfo">
        <span class="rinfo-icon">${ICONS.calendar}</span> Periode: <strong>${esc(periodLabel)}</strong>
        <span class="rinfo-sep">|</span>
        <span class="rinfo-icon">${ICONS.clock}</span> Dicetak: <strong>${esc(printedAtLabel)}</strong>
      </div>

      <div class="scards">${cardsHtml}</div>

      <table class="rtable">
        <thead>${theadHtml}</thead>
        <tbody>${tbodyHtml}</tbody>
      </table>

      <div class="rbottom">
        <div class="rbottom-col">
          <div class="rbottom-head">RINGKASAN</div>
          <div class="sl-list">${summaryListHtml}</div>
        </div>
        <div class="rbottom-col" style="text-align:center;">
          <div class="rbottom-head" style="text-align:left;">DISTRIBUSI INDIKATOR</div>
          <div class="donut-wrap">${donutSvg(donutSegments, donutCenterLines)}
            <div class="legend-list">${legendDotsHtml}</div>
          </div>
        </div>
        <div class="rbottom-col">
          <div class="rbottom-head">KETERANGAN INDIKATOR</div>
          <div class="li-list">${legendItemsHtml}</div>
        </div>
      </div>

      ${notes.length ? `<div class="rnotes"><div class="rnotes-icon">${ICONS.clipboard}</div><div><div class="rnotes-title">CATATAN</div><ul>${notesHtml}</ul></div></div>` : ""}
    </div>

    <div class="rfooter">
      <div class="rfooter-left"><span>${ICONS.globe}</span> www.kla.co.id &nbsp;&nbsp; <span>${ICONS.mail}</span> audit@kla.co.id</div>
      <div class="rfooter-page">${esc(pageLabel)}</div>
    </div>
  </div>`;
}

export const REPORT_STYLE = `
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
  html, body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 0; background: #fff; }
  .page { page-break-after: always; position: relative; padding-bottom: 46px; }
  .rhdr { background: #2A1F52; padding: 16px 22px; display: flex; justify-content: space-between; align-items: center; border-radius: 6px 6px 0 0; }
  .rhdr-left { display: flex; align-items: center; gap: 12px; }
  .rhdr-badge { width: 38px; height: 38px; border-radius: 50%; background: #fff; color: #2A1F52; display: flex; align-items: center; justify-content: center; padding: 8px; }
  .rhdr-badge svg { width: 100%; height: 100%; }
  .rhdr-title { color: #fff; font-weight: 800; font-size: 15px; letter-spacing: 0.03em; }
  .rhdr-sub { color: #F4B740; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; }
  .rhdr-right { display: flex; align-items: center; gap: 8px; }
  .rhdr-icon { width: 22px; height: 22px; color: #F4B740; }
  .rhdr-icon svg { width: 100%; height: 100%; }
  .rhdr-date { color: #fff; font-size: 11px; font-weight: 700; text-align: right; }
  .rhdr-by { color: #c9c2e0; font-size: 8.5px; text-align: right; }
  .rhdr-bar { height: 4px; background: #F4B740; }
  .rbody { padding: 18px 22px 0; }
  .rtitle { font-size: 21px; font-weight: 800; color: #1a1030; }
  .rscope { font-size: 12.5px; font-weight: 800; color: #b8860b; letter-spacing: 0.04em; margin-top: 2px; }
  .rscope-line { width: 40px; height: 3px; background: #F4B740; margin: 6px 0 12px; }
  .rinfo { font-size: 10.5px; color: #555; margin-bottom: 14px; display: flex; align-items: center; gap: 6px; }
  .rinfo-icon { width: 12px; height: 12px; display: inline-flex; color: #7c6aa8; }
  .rinfo-icon svg { width: 100%; height: 100%; }
  .rinfo-sep { margin: 0 4px; color: #ccc; }
  .scards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .scard { border: 1px solid #ddd; border-radius: 8px; padding: 10px; display: flex; align-items: center; gap: 8px; background: #fff; }
  .scard-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; padding: 6px; flex-shrink: 0; }
  .scard-icon svg { width: 100%; height: 100%; }
  .scard-label { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; }
  .scard-value { font-size: 18px; font-weight: 800; color: #1a1030; line-height: 1.2; }
  .scard-sub { font-size: 8px; color: #999; }
  table.rtable { width: 100%; border-collapse: collapse; font-size: 8.5px; margin-bottom: 14px; }
  table.rtable thead tr { background: #2A1F52; }
  table.rtable th { color: #fff; text-align: left; padding: 6px 6px; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.02em; }
  table.rtable td { padding: 5px 6px; border-bottom: 1px solid #eee; }
  table.rtable td.empty { color: #aaa; font-style: italic; }
  .badge { padding: 2px 8px; border-radius: 20px; font-size: 7.5px; font-weight: 800; white-space: nowrap; }
  .rbottom { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .rbottom-col { border: 1px solid #eee; border-radius: 8px; padding: 11px; background: #fafafd; }
  .rbottom-head { font-size: 9px; font-weight: 800; color: #2A1F52; margin-bottom: 8px; border-bottom: 2px solid #F4B740; padding-bottom: 4px; display: inline-block; }
  .sl-list { display: flex; flex-direction: column; gap: 6px; }
  .sl-row { display: flex; align-items: center; gap: 6px; font-size: 9px; }
  .sl-icon { width: 17px; height: 17px; color: #2A1F52; flex-shrink: 0; }
  .sl-icon svg { width: 100%; height: 100%; }
  .sl-label { flex: 1; color: #555; }
  .sl-value { font-weight: 700; color: #1a1030; }
  .sl-strong { border-top: 1px dashed #ccc; padding-top: 6px; margin-top: 2px; font-size: 10px; }
  .sl-strong .sl-value { color: #2A1F52; font-size: 12px; }
  .donut-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .donut-wrap svg { width: 110px; height: 110px; }
  .legend-list { width: 100%; display: flex; flex-direction: column; gap: 4px; text-align: left; }
  .legend-row { display: flex; align-items: center; gap: 6px; font-size: 8.5px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .legend-label { flex: 1; color: #555; }
  .legend-count { font-weight: 700; color: #1a1030; }
  .li-list { display: flex; flex-direction: column; gap: 8px; }
  .li-item { display: flex; gap: 7px; }
  .li-icon { width: 19px; height: 19px; border-radius: 5px; display: flex; align-items: center; justify-content: center; padding: 4px; flex-shrink: 0; }
  .li-icon svg { width: 100%; height: 100%; }
  .li-title { font-size: 8.5px; font-weight: 800; }
  .li-desc { font-size: 7.5px; color: #777; line-height: 1.25; }
  .rnotes { display: flex; gap: 10px; background: #f5f3fa; border-radius: 8px; padding: 11px 14px; margin-bottom: 14px; }
  .rnotes-icon { width: 20px; height: 20px; color: #2A1F52; flex-shrink: 0; }
  .rnotes-icon svg { width: 100%; height: 100%; }
  .rnotes-title { font-size: 9px; font-weight: 800; color: #2A1F52; margin-bottom: 3px; }
  .rnotes ul { margin: 0; padding-left: 14px; font-size: 8.5px; color: #555; line-height: 1.5; }
  .rfooter { background: #2A1F52; padding: 8px 22px; display: flex; justify-content: space-between; align-items: center; border-radius: 0 0 6px 6px; margin-top: 6px; }
  .rfooter-left { color: #cfc7e6; font-size: 8px; display: flex; align-items: center; gap: 5px; }
  .rfooter-left span { display: inline-flex; width: 10px; height: 10px; }
  .rfooter-left span svg { width: 100%; height: 100%; }
  .rfooter-page { background: #fff; color: #2A1F52; font-size: 7.5px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
  @media print {
    html, body { width: 100%; }
    .page { page-break-after: always; }
  }
`;

export function openPrintWindow(title, pagesHtml) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title><meta charset="utf-8"><style>${REPORT_STYLE}</style></head><body>${pagesHtml}
    <script>window.onload = () => setTimeout(() => window.print(), 350);<\/script>
  </body></html>`);
  win.document.close();
  return true;
}
