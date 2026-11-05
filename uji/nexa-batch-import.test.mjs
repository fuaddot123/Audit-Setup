import test from "node:test";
import assert from "node:assert/strict";
import { readCompleteNexa, planNexaBatch } from "../lib/nexaBatchImport.js";
import { readPersediaanTable } from "../lib/persediaanValuation.js";
const headers=["No. Stok Opname","Tanggal","Gudang","Kode Barang","Nama Barang","Jumlah Sistem","Jumlah Opname","Selisih","Status Nexa"];
const rows=[headers,["SOH/00001/202610","2026-10-12","Ruko SMG","A","Barang A",3,1,-2,"COMPLETE UNMATCH"],
  ["SOH/00002/202610","2026-10-15","Tegal","B","Barang B",1,1,0,"COMPLETE MATCH"],
  ["SOH/00003/202610","2026-10-15","Tegal","A","Belum dihitung",100,0,-100,"BELUM COMPLETE"]];
const branches=[{id:1,name:"Semarang"},{id:2,name:"Tegal"}];
const report=readPersediaanTable([["Kode Barang","Nama Barang","Sisa Qty","Sisa Nilai"],["A","Barang A",5,500],["B","Barang B",2,200]],{period:"2026-10",fileName:"report.xlsx"});
const input=()=>({groups:readCompleteNexa(rows).groups,branches,records:[],report,profile:{id:"user",role:"super_admin"},period:"2026-10",ids:{1:"ba-1",2:"ba-2"},fileName:"source.xlsx",fileSha256:"sha",importedAt:"2026-11-05T00:00:00Z"});
test("only COMPLETE source records enter the batch; branches, dates and signed valuation are preserved",()=>{
  const parsed=readCompleteNexa(rows);assert.equal(parsed.excluded,1);assert.equal(parsed.groups.length,2);
  const plan=planNexaBatch(input());assert.equal(plan.entries.length,2);assert.equal(plan.items,2);assert.equal(plan.opnames,2);
  assert.equal(plan.entries[0].auditDate,"2026-10-31");assert.equal(plan.entries[0].kat1[0].nexa.date,"2026-10-12");
  assert.equal(plan.entries[0].kat1[0].nexa.sourceStatus,"COMPLETE UNMATCH");
  assert.equal(plan.entries[0].kat1[0].barang[0].qty,-2);assert.equal(plan.entries[0].kat1[0].barang[0].harga,100);
  assert.equal(plan.entries[0].newId,"ba-1");assert.equal(plan.entries[1].newId,"ba-2");
});
test("duplicate source imports are skipped across BA, with stable IDs for pending branches",()=>{
  const before=input();const first=planNexaBatch(before).entries[0];
  const plan=planNexaBatch({...before,records:[{period:"2026-10",branch_id:1,stock_opname_kat1:first.kat1}]});
  assert.equal(plan.skipped,1);assert.equal(plan.entries.length,1);assert.equal(plan.entries[0].newId,"ba-2");
  assert.throws(()=>planNexaBatch({...before,records:[{period:"2026-10",branch_id:2,stock_opname_kat1:first.kat1}]}),/cabang lain/);
});
test("batch blocks ambiguous branches, wrong periods, missing reports and read-only roles",()=>{
  assert.throws(()=>planNexaBatch({...input(),branches:[]}),/belum cocok/);
  assert.throws(()=>planNexaBatch({...input(),branches:[...branches,{id:3,name:"Semarang"}]}),/belum cocok/);
  assert.throws(()=>planNexaBatch({...input(),report:null}),/Persediaan/);
  assert.throws(()=>planNexaBatch({...input(),period:"2026-09"}),/bulan/);
  assert.throws(()=>planNexaBatch({...input(),profile:{role:"viewer"}}),/Akun/);
  assert.throws(()=>planNexaBatch({...input(),profile:{role:"super_admin",liatSebagai:true}}),/Akun/);
  assert.throws(()=>planNexaBatch({...input(),groups:[...input().groups,input().groups[0]]}),/ganda/);
});
test("missing or inconsistent source status is rejected rather than inferred from zero counts",()=>{
  assert.throws(()=>readCompleteNexa([headers.slice(0,-1),rows[1].slice(0,-1)]),/Status/);
  const conflicting=[...rows,[...rows[1].slice(0,-1),"BELUM COMPLETE"]];
  assert.throws(()=>readCompleteNexa(conflicting),/konsisten/);
});
