// ============================================================
// Cetakan Berita Acara FORMAT BARU — berlaku mulai periode September 2026.
//
// Berkas ini sengaja TERPISAH dari jalur cetak lama di BeritaAcara.js.
// Ketetapan pemilik: Berita Acara periode sebelumnya harus tercetak persis
// seperti saat ditandatangani. Menambal satu fungsi cetak untuk melayani dua
// format adalah cara tercepat membuat dokumen lama ikut berubah tanpa ada
// yang menyadarinya.
//
// Bentuknya MENGALIR, bukan satu lembar tetap:
//   ringkasan skor (halaman pertama saja, karena mengalir)
//   1. AUDIT STOCK OPNAME       — langsung rinci
//   2. AUDIT INVENTARIS         — langsung rinci, 36 item dua kolom
//      + blok BELUM TERSEDIA DI CABANG INI
//   3. AUDIT MONITORING DISPLAY — langsung rinci
//   tanda tangan  — WAJIB di halaman terakhir
//
// Tanda tangan di akhir itu ketetapan pemilik, bukan selera tata letak:
// berita acara yang isinya lebih dari satu halaman tidak boleh ditandatangani
// di halaman pertama — penanda tangan harus melihat seluruh isinya dulu.
// ============================================================

// Sengaja HANYA mengimpor dari lib/format-ba.js. Begitu berkas ini
// menyentuh komponen React, cetakannya tidak bisa lagi diuji di Node.
import {
  INVENTARIS_ITEMS, kunciItem, itemBelumTersedia, skorInventaris,
} from "../lib/format-ba";

const esc = (t) => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const GAYA_CETAK_BARU = `
* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
@page { size: A4 portrait; margin: 7mm; }
html, body { background: #fff; margin: 0; padding: 0; }

.kertas{background:#fff;color:#222;font-family:Arial,Helvetica,sans-serif;font-size:10px;
  padding:16px 20px;box-shadow:0 6px 26px rgba(20,10,50,.25);margin-bottom:14px;
  width:794px;min-width:794px}
.kertas-bungkus{overflow-x:auto}
.k-hdr{display:flex;justify-content:space-between;align-items:center;
  background:linear-gradient(120deg,#2A1F52,#3d2a72);margin:-16px -20px 10px;padding:10px 20px;
  border-bottom:3px solid #F4B740}
.k-badge{width:34px;height:34px;border-radius:9px;background:#F4B740;color:#2A1F52;
  display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px}
.k-co{color:#fff;font-weight:800;font-size:12px}.k-sub{color:#cfc7e6;font-size:8px}
.k-tag{color:#F4B740;font-size:8.5px;font-weight:800;letter-spacing:.06em}
.k-per{color:#fff;font-size:12px;font-weight:800}
.k-info{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:9px}
.k-info .s{background:#f4f2f9;border-radius:6px;padding:5px 8px}
.k-info .l{font-size:7.5px;color:#8a83a0;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.k-info .v{font-size:10.5px;font-weight:700;color:#2A1F52}
.k-strip{background:#2A1F52;color:#fff;font-weight:800;font-size:8.5px;padding:4px 10px;
  border-radius:6px;margin-bottom:6px;letter-spacing:.03em;border-left:4px solid #F4B740;
  display:flex;justify-content:space-between;align-items:center;gap:10px}
.k-strip .kanan{font-weight:700;color:#F4B740;font-size:7.5px;letter-spacing:0}
.k-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.k-kartu{border:1px solid #e4dff2;border-radius:8px;padding:7px;display:flex;align-items:center;gap:8px}
.k-kartu .bl{width:26px;height:26px;border-radius:50%;background:#2A1F52;color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.k-kartu .t{font-size:7.5px;font-weight:800;color:#2A1F52}
.k-kartu .p{font-size:15px;font-weight:900;line-height:1.05}
.k-kartu .b{display:inline-block;font-size:6.5px;font-weight:800;padding:2px 8px;
  border-radius:20px;color:#fff;margin-top:2px}
.k-lg{border-left:1px solid #eee;padding-left:9px;display:flex;flex-direction:column;gap:2px;flex:1}
.k-lg div{display:flex;font-size:7.2px;gap:5px}
.k-lg .v{margin-left:auto;font-weight:800;color:#2A1F52}
.k-tbl{width:100%;border-collapse:collapse;font-size:7.8px;line-height:1.3}
.k-tbl th{background:#f4f2f9;color:#57507a;text-align:left;padding:3px 5px;font-size:6.8px;
  text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e6e2f0}
.k-tbl td{padding:2.5px 5px;border-bottom:1px solid #efedf5;vertical-align:top}
/* Inventaris 40 item disusun dua kolom supaya muat tanpa membuang rincian. */
.k-duakolom{display:grid;grid-template-columns:1fr 1fr;gap:9px;align-items:start}
.k-belum{border:1px solid #cfc7e6;border-left:3px solid #8a83a0;border-radius:4px;
  padding:6px 9px;margin-bottom:9px;page-break-inside:avoid;break-inside:avoid}
.k-belum-j{font-weight:800;font-size:8px;color:#2A1F52;letter-spacing:.4px;margin-bottom:3px}
.k-belum-i{font-size:7.4px;color:#3a3355;line-height:1.5}
.k-belum-k{color:#8a83a0}
.k-belum-n{font-size:6.8px;color:#8a83a0;margin-top:3px;line-height:1.45}
.k-duakolom .k-tbl{font-size:7.2px}
.k-duakolom .k-tbl td{padding:2px 4px}
.k-ok{color:#1a7f56;font-weight:800}.k-bad{color:#a32020;font-weight:800}.k-warn{color:#b06a12;font-weight:800}
.k-netral{color:#8a83a0;font-weight:800}
.k-ttd{display:grid;grid-template-columns:1fr 1fr 2fr;gap:8px;margin-top:9px}
.k-ttd .kk{border:1px solid #e6e2f0;border-radius:6px;padding:6px 8px;text-align:center}
.k-ttd .t{font-size:7.5px;font-weight:800;color:#8a83a0;letter-spacing:.06em}
.k-ttd .g{border-top:1px solid #cfc9dd;margin-top:17px;padding-top:3px;font-size:8.5px;font-weight:700;color:#2A1F52}
.k-cat{border:1px solid #e6e2f0;border-radius:7px;padding:7px 9px;font-size:8px;color:#6b6483}
.k-kaki{display:flex;justify-content:space-between;align-items:center;margin:9px -20px -16px;
  padding:7px 20px;background:#2A1F52;color:#fff}
.k-kaki .n{font-weight:800;font-size:9.5px}.k-kaki .s{font-size:7px;color:#cfc7e6}

/* Penyesuaian untuk KERTAS. Di prototipe .kertas dipatok 794px karena ia
   ditampilkan di dalam layar; di kertas ia harus mengikuti lebar halaman,
   kalau tidak sisi kanannya terpotong tanpa satu pun galat. */
.kertas { width: 100% !important; min-width: 0 !important; box-shadow: none !important; margin: 0 auto !important; }

/* Yang tidak boleh terbelah di antara dua halaman. */
.k-ttd, .k-kartu, .f-unit, .k-belum { page-break-inside: avoid; break-inside: avoid; }
.k-tbl tr { page-break-inside: avoid; break-inside: avoid; }
thead { display: table-header-group; }

/* Foto bukti kerusakan inventaris. */
.inv-foto { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
.inv-foto img { width: 30px; height: 30px; object-fit: cover; border-radius: 3px; border: 1px solid #e6e2f0; }
`;

function kKartu(ikon, judul, angka, warna, lencana, legenda, penuh) {
  return `<div class="k-kartu"${penuh ? ' style="width:100%"' : ""}>`
    + `<div class="bl">${ikon}</div><div><div class="t">${esc(judul)}</div>`
    + `<div class="p" style="color:${warna}">${esc(angka)}</div>`
    + `<div class="b" style="background:${warna}">${esc(lencana)}</div></div>`
    + `<div class="k-lg">${legenda.map((l) => `<div><span>${esc(l[0])}</span><span class="v">${esc(l[1])}</span></div>`).join("")}</div></div>`;
}

// 36 item dibagi dua kolom supaya muat tanpa membuang satu pun rincian.
// Nama kategori hanya ditulis di baris pertamanya — dan juga di baris teratas
// tiap kolom, kalau tidak kolom kanan bisa dibuka dengan item tanpa induk.
function invDuaKolomHtml(inventaris) {
  const semua = [];
  INVENTARIS_ITEMS.forEach((g) => {
    g.items.forEach((nama, idx) => {
      const k = kunciItem(g.kategori, nama);
      semua.push({
        kat: g.kategori, awal: idx === 0, nama,
        d: inventaris[k] || { status: "Berfungsi", keterangan: "", photos: [] },
      });
    });
  });
  const tengah = Math.ceil(semua.length / 2);
  return [semua.slice(0, tengah), semua.slice(tengah)].map((kolom) => (
    `<table class="k-tbl"><thead><tr>`
    + `<th style="width:30%">Kategori</th><th style="width:32%">Inventaris</th>`
    + `<th style="width:17%">Keadaan</th><th>Ket.</th></tr></thead><tbody>`
    + kolom.map((x, n) => {
        const st = x.d.status || "Berfungsi";
        const kelas = st === "Rusak" ? "k-bad" : (st === "Tidak ada" ? "k-netral" : "k-ok");
        const fotoList = (x.d.photos || []).filter((p) => p.type !== "video");
        const foto = fotoList.length
          ? `<div class="inv-foto">${fotoList.map((p) => `<img src="${esc(p.url)}" />`).join("")}</div>`
          : "";
        return `<tr>`
          + `<td>${(x.awal || n === 0) ? `<b>${esc(x.kat.toUpperCase())}</b>` : ""}</td>`
          + `<td>${esc(x.nama.toUpperCase())}</td>`
          + `<td class="${kelas}">${esc(st.toUpperCase())}</td>`
          + `<td>${esc(x.d.keterangan) || "-"}${foto}</td></tr>`;
      }).join("")
    + `</tbody></table>`
  )).join("");
}

// Ketetapan pemilik 31 Agu 2026: item "Tidak ada" TIDAK menurunkan skor,
// tetapi didaftar terpisah. APAR wajib menurut aturan keselamatan; kalau
// hanya jadi satu baris kelabu di tengah tabel 36 item, ia tenggelam.
// Kalau tidak ada satu pun, bloknya tidak muncul sama sekali.
function blokBelumTersedia(inventaris) {
  const t = itemBelumTersedia(inventaris);
  if (!t.length) return "";
  return `<div class="k-belum">`
    + `<div class="k-belum-j">BELUM TERSEDIA DI CABANG INI &mdash; ${t.length} item</div>`
    + t.map((x) => (
        `<div class="k-belum-i"><b>${esc(x.nama.toUpperCase())}</b> `
        + `<span class="k-belum-k">${esc(x.kategori)}</span>`
        + (x.keterangan ? ` &mdash; ${esc(x.keterangan)}` : "")
        + `</div>`
      )).join("")
    + `<div class="k-belum-n">Tidak dihitung dalam skor inventaris &mdash; barang yang belum `
    + `dimiliki cabang bukan temuan. Didaftar di sini supaya ketiadaannya tetap terbaca `
    + `dan bisa ditindaklanjuti.</div></div>`;
}

export function cetakBaruHtml({
  cabang, periodeTeks, tanggalCetakTeks, waktuAudit,
  auditor, teamLeader, storeManager,
  inventaris,
  stokBarisHtml, stokTotal, stokSelisih, stokPct, kat1Pct, kat2Pct,
  displayBarisHtml, displayFotoHtml, displayDipajang, displayLewat, displayBatas,
  skorD, displayInfo,
}) {
  const inv = skorInventaris(inventaris);
  const invWarna = inv.rusak ? "#b06a12" : "#1a7f56";

  const pctDisplay = skorD == null ? "\u2014" : `${skorD.skor_display}%`;

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">`
  + `<title>Berita Acara ${esc(cabang)} &mdash; ${esc(periodeTeks)}</title>`
  + `<style>${GAYA_CETAK_BARU}</style></head><body>`
  + `<div class="kertas">`

  + `<div class="k-hdr"><div style="display:flex;align-items:center;gap:10px">`
  + `<div class="k-badge">K</div><div><div class="k-co">KLA COMPUTER</div>`
  + `<div class="k-sub">DIVISI AUDIT KLA COMPUTER</div></div></div>`
  + `<div style="text-align:right"><div class="k-tag">BERITA ACARA AUDIT STORE</div>`
  + `<div class="k-per">${esc(periodeTeks.toUpperCase())}</div>`
  + `<div class="k-sub">Dicetak ${esc(tanggalCetakTeks)}</div></div></div>`

  + `<div class="k-info">`
  + `<div class="s"><div class="l">Store / Cabang</div><div class="v">${esc(cabang)}</div></div>`
  + `<div class="s"><div class="l">Tanggal Audit</div><div class="v">${esc(waktuAudit) || "\u2014"}</div></div>`
  + `<div class="s"><div class="l">Auditor</div><div class="v">${esc(auditor) || "\u2014"}</div></div>`
  + `<div class="s"><div class="l">Team Leader</div><div class="v">${esc(teamLeader) || "\u2014"}</div></div></div>`

  // Skor di ATAS, sebelum poin 1. Karena dokumennya mengalir, letak ini
  // otomatis berarti "halaman pertama saja" — tidak perlu aturan cetak khusus.
  + `<div class="k-strip">RINGKASAN HASIL AUDIT</div>`
  + `<div class="k-row">`
  + kKartu("\ud83d\udce6", "1. STOCK OPNAME", `${stokPct}%`,
      stokSelisih ? "#b06a12" : "#1a7f56", stokSelisih ? "PERHATIAN" : "TERKENDALI",
      [["Kategori 1", kat1Pct == null ? "\u2014" : `${kat1Pct}%`],
       ["Kategori 2", kat2Pct == null ? "\u2014" : `${kat2Pct}%`]])
  + kKartu("\ud83d\uddc2\ufe0f", "2. INVENTARIS", `${inv.persen}%`, invWarna,
      inv.rusak ? "PERHATIAN" : "BAIK",
      [["Berfungsi", `${inv.berfungsi} item`],
       ["Rusak", `${inv.rusak} item`],
       ["Tidak ada", `${inv.tidakAda} item`]])
  + `</div>`
  + `<div style="margin-bottom:9px">`
  + kKartu("\ud83d\udda5\ufe0f", "3. MONITORING DISPLAY", pctDisplay,
      displayInfo.color, String(displayInfo.lbl).toUpperCase(),
      skorD == null ? [["Belum ada unit dinilai", "\u2014"]]
        : [["Dalam batas umur", `${skorD.unit_dalam_batas}/${skorD.unit_dinilai} unit \u00b7 ${skorD.skor_umur}%`],
           ["Kondisi fisik", `${skorD.skor_kondisi}%`],
           ["Lewat batas", `${displayLewat} unit`]], 1)
  + `</div>`

  + `<div class="k-strip"><span>1. AUDIT STOCK OPNAME</span>`
  + `<span class="kanan">${stokTotal} item \u00b7 ${stokSelisih} selisih</span></div>`
  + `<table class="k-tbl" style="margin-bottom:9px"><thead><tr>`
  + `<th style="width:26%">Kategori</th><th style="width:34%">Item</th>`
  + `<th style="width:16%">Kelengkapan</th><th>Keterangan</th></tr></thead>`
  + `<tbody>${stokBarisHtml}</tbody></table>`

  + `<div class="k-strip"><span>2. AUDIT INVENTARIS</span>`
  + `<span class="kanan">${inv.total} item \u00b7 ${inv.berfungsi} berfungsi \u00b7 ${inv.rusak} rusak`
  + (inv.tidakAda ? ` \u00b7 ${inv.tidakAda} tidak ada` : "") + `</span></div>`
  + `<div class="k-duakolom" style="margin-bottom:9px">${invDuaKolomHtml(inventaris)}</div>`
  + blokBelumTersedia(inventaris)

  + `<div class="k-strip"><span>3. AUDIT MONITORING DISPLAY</span>`
  + `<span class="kanan">${displayDipajang} dipajang \u00b7 ${displayLewat} lewat batas \u00b7 batas ${displayBatas} hari</span></div>`
  + `<table class="k-tbl"><thead><tr><th style="width:23%">Brand / Model</th><th style="width:12%">Serial</th>`
  + `<th style="width:11%">Mulai Pajang</th><th style="width:14%">Umur saat audit</th>`
  + `<th style="width:15%">Kondisi</th><th>Program / Perlakuan</th></tr></thead>`
  + `<tbody>${displayBarisHtml}</tbody></table>`
  + (displayFotoHtml ? `<div style="margin-top:6px">${displayFotoHtml}</div>` : "")

  + `<div class="k-ttd"><div class="kk"><div class="t">MENGETAHUI</div>`
  + `<div class="g">${esc(storeManager || teamLeader) || "\u2014"}</div></div>`
  + `<div class="kk"><div class="t">PELAKSANA</div><div class="g">${esc(auditor) || "\u2014"}</div></div>`
  + `<div class="k-cat"><div style="font-size:7.5px;font-weight:800;color:#2A1F52;letter-spacing:.06em;margin-bottom:3px">CATATAN</div>`
  + `Berita acara ini dibuat berdasarkan hasil audit yang dilakukan pada ${esc(waktuAudit) || "periode terkait"} di Store `
  + `${esc(cabang)}. Demikian dibuat dengan sebenar-benarnya untuk dipergunakan sebagaimana mestinya.`
  + `<div style="margin-top:4px;font-weight:700;color:#2A1F52">Tanggal: ${esc(tanggalCetakTeks)}</div></div></div>`

  + `<div class="k-kaki"><div><div class="n">KLA COMPUTER</div>`
  + `<div class="s">Solusi Lengkap Kebutuhan Digital Anda</div></div>`
  + `<div class="s">klacomputer.co.id \u00b7 audit@klacomputer.id</div></div>`
  + `</div></body></html>`;
}
