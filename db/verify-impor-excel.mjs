#!/usr/bin/env node
// Uji pembaca berkas Excel untuk impor RAB (src/lib/rab/impor-excel.ts).
//
// Modul itu MEMBACA SENDIRI format .xlsx, tanpa dependency (alasannya di kepala
// berkas tersebut). Pembacaan sendiri hanya sah kalau dibuktikan terhadap
// pembanding yang independen, karena parser yang salah baca tidak terlihat
// salah: ia mengembalikan angka yang rapi, hanya bukan angka yang ada di sheet.
// Angka anggaran yang salah baca adalah kegagalan fatal di repo ini.
//
// Karena itu berkas ini melakukan tiga hal:
//
//   1. Membandingkan SETIAP SEL dengan pembacaan Python openpyxl -- bukan
//      beberapa sel contoh, melainkan seluruh sel pada kedua sheet yang dipetakan,
//      lalu seluruh sel pada seluruh 26 sheet sebagai sapuan tambahan.
//   2. Menjalankan pemetaan pada template sungguhan dan mencetak apa adanya:
//      jumlah komponen & asumsi, SELURUH Masalah, dan total volume x harga
//      (supaya bisa dicocokkan manual dengan baris SUBTOTAL di sheet).
//   3. Menguji kasus tepi yang TIDAK ada di template sungguhan -- angka
//      berbentuk teks, kolom bertukar tempat, header di baris lain, total yang
//      tidak cocok -- lewat workbook sintetis yang ditulis openpyxl.
//
//   node db/verify-impor-excel.mjs
//
// Tidak menyentuh database dan tidak menyentuh jaringan.
//
// Prasyarat:
//   * Node >= 22.18 (import berkas .ts langsung lewat type stripping, pola yang
//     sama dengan scripts/verify-idtoken.mjs).
//   * python3 dengan openpyxl (`pip install openpyxl`). Pembandingnya memang
//     harus alat lain; membandingkan parser dengan dirinya sendiri tidak
//     membuktikan apa pun.
//   * docs/RAB_Agroforestry_100ha_Banyumas_R2.xlsx.

import { registerHooks } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AKAR = new URL("../", import.meta.url);

// Node tidak tahu alias "@/..." dari tsconfig, dan ESM tidak menebak ekstensi
// .ts. Hook kecil ini menjembatani keduanya supaya yang diuji benar-benar
// BERKAS SUMBER-nya, bukan salinan yang bisa menyimpang diam-diam.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let s = specifier;
    if (s.startsWith("@/")) s = new URL(`src/${s.slice(2)}`, AKAR).href;
    if (s.startsWith("file://") || s.startsWith(".")) {
      const url = new URL(s, context.parentURL ?? AKAR);
      if (!/\.[cm]?[jt]sx?$/.test(url.pathname) && existsSync(fileURLToPath(`${url.href}.ts`))) {
        s = `${url.href}.ts`;
      }
    }
    return nextResolve(s, context);
  },
});

const MODUL = fileURLToPath(new URL("src/lib/rab/impor-excel.ts", AKAR));
let mod;
try {
  mod = await import(MODUL);
} catch (e) {
  console.error("Gagal meng-import src/lib/rab/impor-excel.ts:", e.message);
  console.error("Butuh Node >= 22.18 (type stripping). Versi sekarang:", process.version);
  process.exit(1);
}
const { bacaWorkbookRab, bukaWorkbookMentah, SHEET_KOMPONEN, SHEET_ASUMSI, SHEET_CEK } = mod;

const BERKAS = fileURLToPath(new URL("docs/RAB_Agroforestry_100ha_Banyumas_R2.xlsx", AKAR));
if (!existsSync(BERKAS)) {
  console.error("Template tidak ditemukan:", BERKAS);
  console.error("Berkas contoh itu yang menjadi acuan; tanpa dia tidak ada yang bisa dibuktikan.");
  console.error("Salin revisi R2 ke docs/ (berkas itu belum dilacak git) lalu jalankan ulang.");
  process.exit(1);
}

let lulus = 0;
let gagal = 0;
const ok = (nama, kondisi, tambahan = "") => {
  const ekor = tambahan ? ` — ${tambahan}` : "";
  if (kondisi) {
    lulus++;
    console.log(`  LULUS  ${nama}${ekor}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}${ekor}`);
  }
};
const angka = (n) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 }).format(n);

// ===========================================================================
// Pembanding independen: openpyxl lewat python3
// ===========================================================================

const PY_DUMP = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
keluar = {}
for nama in wb.sheetnames:
    ws = wb[nama]
    sel = {}
    for baris in ws.iter_rows():
        for c in baris:
            v = c.value
            if v is None:
                continue
            if isinstance(v, bool):
                pass
            elif isinstance(v, int):
                if abs(v) > 2**53:
                    v = {"__luar_jangkauan": str(v)}
            elif isinstance(v, float) or isinstance(v, str):
                pass
            else:
                v = {"__jenis": type(v).__name__, "__teks": str(v)}
            sel["%d,%d" % (c.row, c.column)] = v
    keluar[nama] = {"barisMaks": ws.max_row or 0, "kolomMaks": ws.max_column or 0, "sel": sel}
json.dump(keluar, sys.stdout, ensure_ascii=False)
`;

function bacaDenganOpenpyxl(jalur) {
  const r = spawnSync("python3", ["-c", PY_DUMP, jalur], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error && r.error.code === "ENOENT") {
    console.error("python3 tidak ada di PATH. Pembanding independen wajib ada; uji ini tidak bisa dilewati.");
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error("openpyxl gagal membaca berkas:\n" + (r.stderr || "").trim());
    console.error("Pasang pembandingnya lebih dulu: pip install openpyxl");
    process.exit(1);
  }
  return JSON.parse(r.stdout);
}

/** Python '' dan null-nya pembaca kami sama-sama berarti "sel tanpa isi". */
const samaSel = (a, b) => a === b || (a === "" && b === null) || (a === null && b === "");

function bandingkanSheet(nama, py, js) {
  const barisMaks = Math.max(py?.barisMaks ?? 0, js?.barisMaks ?? 0);
  const kolomMaks = Math.max(py?.kolomMaks ?? 0, js?.kolomMaks ?? 0);
  let dibandingkan = 0;
  let beda = 0;
  const contoh = [];
  for (let b = 1; b <= barisMaks; b++) {
    for (let k = 1; k <= kolomMaks; k++) {
      const a = py?.sel[`${b},${k}`] ?? null;
      const c = js ? js.sel(b, k) : null;
      dibandingkan++;
      if (samaSel(a, c)) continue;
      beda++;
      if (contoh.length < 8) {
        contoh.push(`baris ${b} kolom ${k}: openpyxl=${JSON.stringify(a)} vs kami=${JSON.stringify(c)}`);
      }
    }
  }
  return { nama, dibandingkan, beda, contoh };
}

// ===========================================================================
// BAGIAN 1 — Perbandingan sel-per-sel dengan openpyxl
// ===========================================================================

console.log("=== BAGIAN 1: setiap sel dibandingkan dengan openpyxl ===");
const isi = readFileSync(BERKAS);
const dariPython = bacaDenganOpenpyxl(BERKAS);
const dariKami = bukaWorkbookMentah(isi);

console.log(`  Berkas   : docs/${BERKAS.split("/").pop()} (${isi.length.toLocaleString("id-ID")} byte)`);
console.log(`  Sheet    : openpyxl ${Object.keys(dariPython).length}, pembaca kami ${dariKami.size}`);
ok(
  "jumlah & nama sheet identik",
  Object.keys(dariPython).length === dariKami.size && Object.keys(dariPython).every((n) => dariKami.has(n)),
  Object.keys(dariPython)
    .filter((n) => !dariKami.has(n))
    .join(", ") || "semua cocok",
);

let totalSel = 0;
let totalBeda = 0;
for (const nama of [SHEET_KOMPONEN, SHEET_ASUMSI]) {
  const h = bandingkanSheet(nama, dariPython[nama], dariKami.get(nama));
  totalSel += h.dibandingkan;
  totalBeda += h.beda;
  ok(
    `sheet "${nama}"`,
    h.beda === 0,
    `${h.dibandingkan.toLocaleString("id-ID")} sel dibandingkan, ${h.beda} berbeda`,
  );
  for (const c of h.contoh) console.log(`           ${c}`);
}

// Sapuan tambahan: seluruh sheet, bukan hanya dua yang dipetakan. Sheet lain
// belum dipakai modul ini, tapi kalau pembacanya salah pada salah satu dari
// mereka, ia juga akan salah pada sheet berikutnya yang kami tambahkan.
let selSemua = 0;
let bedaSemua = 0;
const sheetBermasalah = [];
for (const nama of Object.keys(dariPython)) {
  const h = bandingkanSheet(nama, dariPython[nama], dariKami.get(nama));
  selSemua += h.dibandingkan;
  bedaSemua += h.beda;
  if (h.beda > 0) sheetBermasalah.push(`${nama} (${h.beda}): ${h.contoh[0] ?? ""}`);
}
ok(
  "sapuan seluruh 26 sheet",
  bedaSemua === 0,
  `${selSemua.toLocaleString("id-ID")} sel dibandingkan, ${bedaSemua} berbeda`,
);
for (const s of sheetBermasalah) console.log(`           ${s}`);

console.log(
  `  RINGKAS  dua sheet yang dipetakan: ${totalSel.toLocaleString("id-ID")} sel, ${totalBeda} beda; ` +
    `seluruh workbook: ${selSemua.toLocaleString("id-ID")} sel, ${bedaSemua} beda`,
);

// ===========================================================================
// BAGIAN 2 — Hasil pemetaan pada template sungguhan
// ===========================================================================

const TAHAP_SAH = new Set([
  "A Land", "A Assessment", "A Survey", "A Safeguard", "A Design",
  "B Land prep", "B Soil", "C Road", "C Drain", "C Boundary", "C Facility",
  "C Water", "C Power", "C Mobilization", "D Planting", "D Ecology",
  "E Equipment", "F Systems", "F Payroll",
]);

for (const skenario of ["1lokasi", "4lokasi"]) {
  console.log(`\n=== BAGIAN 2: pemetaan template sungguhan — skenario ${skenario} ===`);
  const hasil = bacaWorkbookRab(isi, { skenario });

  console.log(`  Komponen terbaca : ${hasil.komponen.length}`);
  console.log(`  Asumsi terbaca   : ${hasil.asumsi.length}`);
  console.log(`  Masalah          : ${hasil.masalah.length}`);
  for (const m of hasil.masalah) {
    console.log(`      [${m.sheet} baris ${m.baris}] ${m.pesan}`);
  }

  // Total volume x harga -- BUKAN penjumlahan kolom Total di sheet. Angka ini
  // yang nanti dihitung ulang database lewat amount_idr (GENERATED), jadi
  // inilah yang harus dicocokkan manual dengan sheet.
  let total = 0;
  let barisTerhitung = 0;
  for (const k of hasil.komponen) {
    if (k.volume !== null && k.hargaSatuan !== null) {
      total += k.volume * k.hargaSatuan;
      barisTerhitung++;
    }
  }
  console.log(`  TOTAL volume x harga (${barisTerhitung} baris): Rp ${angka(total)}`);

  const dariRumus = {
    volume: hasil.komponen.filter((k) => k.volumeDariRumus).length,
    harga: hasil.komponen.filter((k) => k.hargaDariRumus).length,
  };
  console.log(
    `  Nilai hasil rumus: ${dariRumus.volume}/${hasil.komponen.length} volume, ` +
      `${dariRumus.harga}/${hasil.komponen.length} harga satuan`,
  );
  const sm = hasil.statusModel;
  console.log(`  STATUS MODEL (${SHEET_CEK}): ${sm ? (sm.status ?? "—") : "sheet tidak ada"}`);
  for (const g of sm?.gagal ?? []) console.log(`      GAGAL: ${g.pemeriksaan} (selisih ${g.selisih ?? "—"})`);

  // Pembanding mandiri di dalam sheet itu sendiri: baris SUBTOTAL. Kalau
  // keduanya sama, pemetaan kolom kami membaca kolom yang sama dengan yang
  // dijumlahkan penyusun modelnya.
  const lembar = dariKami.get(SHEET_KOMPONEN);
  const judulTotal = skenario === "1lokasi" ? "total 1 lokasi" : "total 4 lokasi";
  let kolomTotal = 0;
  let barisHeader = 0;
  for (let b = 1; b <= 30 && kolomTotal === 0; b++) {
    for (let k = 1; k <= lembar.kolomMaks; k++) {
      const v = lembar.sel(b, k);
      if (typeof v === "string" && v.trim().toLowerCase() === judulTotal) {
        kolomTotal = k;
        barisHeader = b;
        break;
      }
    }
  }
  let subtotal = null;
  for (let b = barisHeader + 1; b <= lembar.barisMaks; b++) {
    const label = lembar.sel(b, 1);
    if (typeof label === "string" && label.trim().toUpperCase().startsWith("SUBTOTAL")) {
      subtotal = lembar.sel(b, kolomTotal);
      break;
    }
  }
  ok(
    "total volume x harga cocok dengan baris SUBTOTAL di sheet",
    subtotal !== null && Math.abs(subtotal - total) <= 1,
    `SUBTOTAL sheet Rp ${angka(subtotal)} vs hitungan kami Rp ${angka(total)}`,
  );

  // Panduan_Per_Sheet baris 20: 08_CAPEX_RAB "menarik jumlah dan harga dari 02,
  // 04, 05, 06, 14, dan 17". Kalau tidak satu pun nilai terdeteksi sebagai
  // rumus, pendeteksinya yang rusak -- bukan sheet-nya yang berubah.
  ok(
    "nilai turunan terdeteksi sebagai rumus",
    dariRumus.volume > 0 && dariRumus.harga > 0,
    `${dariRumus.volume} volume, ${dariRumus.harga} harga`,
  );
  ok(
    "ringkasan rumus diterbitkan sekali per sheet, bukan per baris",
    hasil.masalah.filter((m) => m.sheet === SHEET_KOMPONEN && /berasal dari rumus/.test(m.pesan)).length === 1 &&
      hasil.masalah.filter((m) => m.sheet === SHEET_ASUMSI && /berasal dari rumus/.test(m.pesan)).length === 1,
  );
  ok(
    "baris yang harganya diketik tidak ditandai rumus",
    hasil.komponen.some((k) => !k.hargaDariRumus),
    `${hasil.komponen.filter((k) => !k.hargaDariRumus).length} baris berharga ketik`,
  );
  ok("STATUS MODEL terbaca dari 15_Checks", sm !== null && sm.status === "PASS", `status=${sm?.status ?? "—"}`);
  ok(
    "pemeriksaan berstatus OK tidak dianggap gagal",
    sm !== null && sm.gagal.length === 0,
    `${sm?.gagal.length ?? 0} gagal`,
  );
  ok("workbook tetap diimpor walau ada pemeriksaan", hasil.komponen.length > 0);
  ok("ada komponen terbaca", hasil.komponen.length > 0, `${hasil.komponen.length} baris`);
  ok("ada asumsi terbaca", hasil.asumsi.length > 0, `${hasil.asumsi.length} baris`);
  ok(
    "baris SUBTOTAL/CADANGAN/TOTAL tidak ikut jadi komponen",
    !hasil.komponen.some((k) => /^(sub)?total|^cadangan/i.test(k.uraian)),
  );
  ok("setiap komponen punya uraian", hasil.komponen.every((k) => k.uraian.trim().length > 0));
  ok(
    "tahap selalu dari daftar tertutup atau null",
    hasil.komponen.every((k) => k.tahap === null || TAHAP_SAH.has(k.tahap)),
  );
  ok(
    "keyakinan selalu high/medium/low atau null",
    hasil.asumsi.every((a) => a.keyakinan === null || ["high", "medium", "low"].includes(a.keyakinan)),
  );

  // Rule "null bukan 0": harga Rp 0 yang MEMANG tertulis 0 harus tetap 0.
  const lahan = hasil.komponen.find((k) => /land acquisition/i.test(k.uraian));
  ok(
    "harga Rp 0 yang disengaja tetap 0, bukan null",
    lahan !== undefined && lahan.hargaSatuan === 0,
    lahan ? `"${lahan.uraian}" hargaSatuan=${JSON.stringify(lahan.hargaSatuan)}` : "baris tidak ditemukan",
  );

  // Volume kedua skenario memang berbeda pada baris yang dipengaruhi jumlah
  // lokasi; kalau tidak, berarti kolom skenario tidak benar-benar dipilih.
  const dueDiligence = hasil.komponen.find((k) => /legal\/title/i.test(k.uraian));
  ok(
    "kolom volume mengikuti skenario",
    dueDiligence !== undefined && dueDiligence.volume === (skenario === "1lokasi" ? 1 : 4),
    dueDiligence ? `"${dueDiligence.uraian}" volume=${angka(dueDiligence.volume)}` : "baris tidak ditemukan",
  );
}

// ===========================================================================
// BAGIAN 3 — Kasus tepi lewat workbook sintetis yang ditulis openpyxl
//
// Template sungguhan hampir seluruhnya berisi sel numerik asli, jadi ia TIDAK
// menguji bagian paling berbahaya dari pembaca ini: angka berbentuk teks,
// kolom yang bertukar tempat, header di baris lain, dan Total yang tidak sama
// dengan volume x harga. Workbook di bawah dibuat khusus untuk itu.
// ===========================================================================

const PY_SINTETIS = `
import sys, openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "08_CAPEX_RAB"
ws["A1"] = "Judul yang tidak ada hubungannya"
# Header di baris 2 (bukan 4) dan kolom sengaja diacak urutannya.
ws.append([])
ws.append(["Uraian", "  HARGA   SATUAN ", "Tahap", "Jumlah 4 lokasi", "Penggerak",
           "Jumlah 1 lokasi", "Total 1 lokasi", "Satuan", "Total 4 lokasi",
           "Dasar/sumber/pengecualian"])
def baris(u, harga, tahap, v4, peng, v1, t1, satuan, t4, sumber):
    ws.append([u, harga, tahap, v4, peng, v1, t1, satuan, t4, sumber])
baris("Angka berbentuk teks", "Rp 35.000.000", "  b land PREP ", "2", "Gross HA", "1.000.000",
      35000000000000, "ha", 70000000000000, "S08")
baris("Ribuan ambigu", 100, "A Land", 1, "lot", "1.000", None, "lot", None, None)
baris("Angka karangan", "sekitar 5 juta", "A Land", 1, "lot", 2, None, "lot", None, None)
baris("Tahap & penggerak asing", 10, "Z Entah", 1, "system", 1, 10, "unit", 10, None)
ws.append([None, None, "baris pemisah tanpa uraian", None, None, None, None, None, None, None])
baris("Harga hilang", None, "A Land", 1, "lot", 1, None, "lot", None, None)
baris("Total tidak cocok", 100, "A Land", 2, "unit", 2, 250, "unit", 250, None)
baris("Nol yang disengaja", 0, "A Land", 10, "unit", 10, 0, "unit", 0, "OPEN")
baris("Kurung akuntansi", "(1.500,50)", "A Land", 1, "unit", 1, None, "unit", None, None)
# openpyxl menulis rumus TANPA nilai ter-cache: rumusnya ada, nilainya tidak
# pernah ada. Persis yang terjadi bila berkas dibuat alat selain Excel.
baris("Rumus tanpa nilai", 10, "A Land", 1, "unit", "=1+1", None, "unit", None, None)

wc = wb.create_sheet("15_Checks")
wc.append(["Pemeriksaan Model dan Peringatan Kritis"])
wc.append([])
wc.append(["Pemeriksaan", "Aktual", "Harapan", "Selisih", "Toleransi", "Status", "Lokasi perbaikan"])
wc.append(["Luas konsisten", 100, 100, 0, 0.01, "OK", "02_Assumptions"])
wc.append(["CAPEX terikat skenario", 5, 7, -2, 1, "FAIL", "08_CAPEX_RAB"])
wc.append(["STATUS MODEL", None, None, None, None, "FAIL", None])
wc.append([])
wc.append(["Peringatan yang tidak menggagalkan rumus"])
wc.append(["Biaya lahan masih Rp0 sampai ada objek nyata."])
wc.append([])
wc.append(["Pemeriksaan", "Nilai aktual", "Batas/harapan", "Selisih", "Penjelasan", "Status", "Tindakan"])
wc.append(["Kas kumulatif T10", -5, 0, -5, "Harus positif", "CEK", "Perbaiki penggerak"])

wa = wb.create_sheet("02_Assumptions")
wa["A1"] = "Pusat asumsi"
wa.append([])
wa.append([])
wa.append(["Kelompok", "Variabel", "Nilai", "Satuan", "ID sumber", "Tingkat keyakinan", "Catatan"])
wa.append(["Proyek", "Luas bruto", 100, "ha", "USR", "High", "penggerak utama"])
wa.append(["Desain", "Kerapatan kelapa", 83, "pohon/ha", "DES", "Sedang", "ejaan Indonesia"])
wa.append(["Kelompok", "Variabel", "Nilai", "Satuan", "ID sumber", "Tingkat keyakinan", "Catatan"])
wa.append(["Keuangan", "Diskonto", 0.12, "%", "ASM", "Sangat yakin", "keyakinan tak dikenal"])
wa.append(["Keuangan", "Belum dinilai", 7, "unit", None, None, "keyakinan kosong"])
wa.append(["A. Seksi baru", None, None, None, None, None, None])
wa.append(["Matriks", 1, 0.9, None, None, None, "variabel numerik"])
wb.save(sys.argv[1])

# Berkas kedua: template yang kolom Tahap dan kolom sumbernya hilang sama sekali.
wb2 = openpyxl.Workbook()
w2 = wb2.active
w2.title = "08_CAPEX_RAB"
w2.append(["Uraian", "Penggerak", "Jumlah 1 lokasi", "Satuan", "Harga satuan", "Total 1 lokasi"])
w2.append(["Tanpa kolom tahap", "lot", 2, "lot", 5000, 10000])
wb2.create_sheet("02_Assumptions").append(
    ["Kelompok", "Variabel", "Nilai", "Satuan", "ID sumber", "Tingkat keyakinan", "Catatan"])
wb2.save(sys.argv[2])
`;

console.log("\n=== BAGIAN 3: kasus tepi (workbook sintetis dari openpyxl) ===");
const dirTmp = (process.env.TMPDIR ?? "/tmp").replace(/\/+$/, "");
const jalurSintetis = `${dirTmp}/agrovision-impor-excel-sintetis.xlsx`;
const jalurTanpaKolom = `${dirTmp}/agrovision-impor-excel-tanpa-kolom.xlsx`;
const buat = spawnSync("python3", ["-c", PY_SINTETIS, jalurSintetis, jalurTanpaKolom], { encoding: "utf8" });
if (buat.status !== 0) {
  console.error("Gagal membuat workbook sintetis:\n" + (buat.stderr || "").trim());
  process.exit(1);
}

try {
  const s1 = bacaWorkbookRab(readFileSync(jalurSintetis), { skenario: "1lokasi" });
  const s4 = bacaWorkbookRab(readFileSync(jalurSintetis), { skenario: "4lokasi" });
  const cari = (h, u) => h.komponen.find((k) => k.uraian === u);
  // Nomor baris saja tidak cukup untuk menyaring Masalah: baris 9 ada di KEDUA
  // sheet, dan tanpa menyebut sheet-nya, Masalah dari 02_Assumptions ikut
  // terhitung sebagai Masalah baris komponen.
  const pesanDi = (h, sheet, baris) =>
    h.masalah.filter((m) => m.sheet === sheet && m.baris === baris).map((m) => m.pesan);
  const pesan = (h, u) => {
    const k = cari(h, u);
    return k ? pesanDi(h, SHEET_KOMPONEN, k.barisAsli) : [];
  };

  console.log(`  Komponen: ${s1.komponen.length} · Asumsi: ${s1.asumsi.length} · Masalah: ${s1.masalah.length}`);
  for (const m of s1.masalah) console.log(`      [${m.sheet} baris ${m.baris}] ${m.pesan}`);

  ok(
    "header ditemukan walau ada di baris 3 dan kolom diacak",
    cari(s1, "Angka berbentuk teks") !== undefined,
  );
  const teks = cari(s1, "Angka berbentuk teks");
  ok(
    'angka teks "1.000.000" dan "Rp 35.000.000" terbaca',
    teks?.volume === 1000000 && teks?.hargaSatuan === 35000000,
    `volume=${angka(teks?.volume)} harga=${angka(teks?.hargaSatuan)}`,
  );
  ok(
    'judul "  HARGA   SATUAN " (spasi & huruf besar) tetap ketemu',
    teks?.hargaSatuan === 35000000,
  );
  ok(
    'tahap "  b land PREP " dinormalkan ke "B Land prep"',
    teks?.tahap === "B Land prep",
    JSON.stringify(teks?.tahap),
  );
  ok('penggerak "Gross HA" dinormalkan ke "gross ha"', teks?.penggerak === "gross ha", JSON.stringify(teks?.penggerak));

  const ambigu = cari(s1, "Ribuan ambigu");
  ok(
    '"1.000" ditolak sebagai ambigu, bukan ditebak',
    ambigu?.volume === null && pesan(s1, "Ribuan ambigu").some((p) => /ambigu/i.test(p)),
    JSON.stringify(pesan(s1, "Ribuan ambigu")),
  );
  const karangan = cari(s1, "Angka karangan");
  ok(
    '"sekitar 5 juta" jadi null + Masalah',
    karangan?.hargaSatuan === null && pesan(s1, "Angka karangan").length > 0,
    JSON.stringify(pesan(s1, "Angka karangan")),
  );
  const asing = cari(s1, "Tahap & penggerak asing");
  ok(
    "tahap/penggerak di luar daftar jadi null + Masalah (tanpa menebak yang mirip)",
    asing?.tahap === null && asing?.penggerak === null && pesan(s1, "Tahap & penggerak asing").length === 2,
    JSON.stringify(pesan(s1, "Tahap & penggerak asing")),
  );
  // Baris 8 sintetis hanya berisi teks di kolom Tahap, tanpa uraian: tidak
  // boleh muncul sebagai komponen DAN tidak boleh meninggalkan Masalah apa pun.
  ok(
    "baris tanpa uraian dilewati diam-diam",
    !s1.komponen.some((k) => k.barisAsli === 8) && pesanDi(s1, SHEET_KOMPONEN, 8).length === 0,
    JSON.stringify(pesanDi(s1, SHEET_KOMPONEN, 8)),
  );
  ok(
    "baris beruraian tanpa harga tetap menghasilkan Masalah",
    cari(s1, "Harga hilang")?.hargaSatuan === null &&
      pesan(s1, "Harga hilang").some((p) => /tidak punya harga/i.test(p)),
    JSON.stringify(pesan(s1, "Harga hilang")),
  );
  const cocok = cari(s1, "Total tidak cocok");
  ok(
    "Total yang tidak sama dengan volume x harga dilaporkan",
    cocok?.totalDiSheet === 250 &&
      cocok?.volume === 2 &&
      cocok?.hargaSatuan === 100 &&
      pesan(s1, "Total tidak cocok").some((p) => /tidak sama dengan volume/i.test(p)),
    JSON.stringify(pesan(s1, "Total tidak cocok")),
  );
  const nol = cari(s1, "Nol yang disengaja");
  ok(
    "harga 0 yang tertulis tetap 0 dan tidak jadi Masalah",
    nol?.hargaSatuan === 0 && pesan(s1, "Nol yang disengaja").length === 0,
  );
  ok(
    'format akuntansi "(1.500,50)" jadi -1500,5',
    cari(s1, "Kurung akuntansi")?.hargaSatuan === -1500.5,
    angka(cari(s1, "Kurung akuntansi")?.hargaSatuan),
  );

  // Skenario memilih PASANGAN kolom yang benar (volume dan total sekaligus).
  ok(
    "skenario 1lokasi memakai kolom Jumlah 1 lokasi",
    cari(s1, "Tahap & penggerak asing")?.volume === 1 && cari(s1, "Angka berbentuk teks")?.volume === 1000000,
  );
  ok(
    "skenario 4lokasi memakai kolom Jumlah 4 lokasi",
    cari(s4, "Angka berbentuk teks")?.volume === 2 && cari(s4, "Angka berbentuk teks")?.totalDiSheet === 70000000000000,
    `volume=${angka(cari(s4, "Angka berbentuk teks")?.volume)}`,
  );

  const asumsi = (v) => s1.asumsi.find((a) => a.variabel === v);
  ok("keyakinan High -> high", asumsi("Luas bruto")?.keyakinan === "high");
  ok("keyakinan Sedang -> medium", asumsi("Kerapatan kelapa")?.keyakinan === "medium");
  ok(
    "keyakinan tak dikenal -> null + Masalah",
    asumsi("Diskonto")?.keyakinan === null &&
      pesanDi(s1, SHEET_ASUMSI, asumsi("Diskonto")?.barisAsli).some((p) => /keyakinan/i.test(p)),
  );
  ok(
    "keyakinan kosong -> null TANPA Masalah (belum dinilai, bukan salah)",
    asumsi("Belum dinilai")?.keyakinan === null &&
      pesanDi(s1, SHEET_ASUMSI, asumsi("Belum dinilai")?.barisAsli).length === 0,
    JSON.stringify(pesanDi(s1, SHEET_ASUMSI, asumsi("Belum dinilai")?.barisAsli)),
  );
  ok("baris yang mengulang header dilewati", asumsi("Variabel") === undefined);
  ok("judul seksi (kolom pertama saja) dilewati diam-diam", asumsi("A. Seksi baru") === undefined);
  ok(
    "variabel numerik tidak diimpor tapi dilaporkan",
    !s1.asumsi.some((a) => a.variabel === "1") && s1.masalah.some((m) => /Kolom Variabel berisi angka/i.test(m.pesan)),
  );
  const rumusKosong = cari(s1, "Rumus tanpa nilai");
  ok(
    "rumus tanpa nilai ter-cache: ditandai rumus, nilainya null",
    rumusKosong?.volumeDariRumus === true && rumusKosong?.volume === null,
    `volumeDariRumus=${rumusKosong?.volumeDariRumus} volume=${JSON.stringify(rumusKosong?.volume)}`,
  );
  ok(
    "pesannya menyuruh simpan ulang di Excel, bukan mengisi sel",
    pesan(s1, "Rumus tanpa nilai").some((p) => /simpan ulang di Excel/i.test(p)),
    JSON.stringify(pesan(s1, "Rumus tanpa nilai")),
  );
  ok(
    "harga yang diketik pada baris yang sama TIDAK ditandai rumus",
    rumusKosong?.hargaDariRumus === false && rumusKosong?.hargaSatuan === 10,
  );

  // --- 15_Checks
  const cek = s1.statusModel;
  console.log(`  STATUS MODEL sintetis: ${cek?.status ?? "—"}`);
  for (const g of cek?.gagal ?? []) console.log(`      GAGAL: ${g.pemeriksaan} (selisih ${g.selisih ?? "—"})`);
  ok("STATUS MODEL yang FAIL diteruskan apa adanya", cek?.status === "FAIL", `status=${cek?.status}`);
  ok(
    "pemeriksaan gagal terkumpul beserta selisihnya",
    cek?.gagal.length === 2 &&
      cek.gagal[0].pemeriksaan === "CAPEX terikat skenario" &&
      cek.gagal[0].selisih === "-2",
    JSON.stringify(cek?.gagal),
  );
  ok(
    "tabel pemeriksaan KEDUA (judul kolom berbeda) ikut terbaca",
    cek?.gagal.some((g) => g.pemeriksaan === "Kas kumulatif T10" && g.selisih === "-5"),
  );
  ok(
    "baris peringatan tanpa status tidak dihitung sebagai pemeriksaan gagal",
    !cek?.gagal.some((g) => /Biaya lahan/i.test(g.pemeriksaan)),
  );
  ok(
    "pemeriksaan yang gagal TIDAK memblokir impor",
    s1.komponen.length > 0 && s1.asumsi.length > 0,
    `${s1.komponen.length} komponen tetap terbaca`,
  );

  // Kolom wajib yang hilang harus dilaporkan SEKALI di tingkat header, bukan
  // diam-diam mengosongkan isian di setiap baris.
  const hilang = bacaWorkbookRab(readFileSync(jalurTanpaKolom), { skenario: "1lokasi" });
  const pesanHeader = hilang.masalah.filter((m) => m.sheet === SHEET_KOMPONEN).map((m) => m.pesan);
  ok(
    "kolom wajib yang hilang dilaporkan sekali di header",
    pesanHeader.filter((p) => /Kolom "Tahap" tidak ada/i.test(p)).length === 1 &&
      pesanHeader.some((p) => /Kolom "dasar\/sumber\/pengecualian" tidak ada/i.test(p)),
    JSON.stringify(pesanHeader),
  );
  ok(
    "statusModel null bila 15_Checks tidak ada di berkas",
    hilang.statusModel === null,
    JSON.stringify(hilang.statusModel),
  );
  ok(
    "barisnya tetap terbaca, isian yang kolomnya hilang jadi null",
    hilang.komponen.length === 1 &&
      hilang.komponen[0].tahap === null &&
      hilang.komponen[0].sumberRef === null &&
      hilang.komponen[0].volume === 2 &&
      hilang.komponen[0].hargaSatuan === 5000,
    JSON.stringify(hilang.komponen[0]),
  );
} finally {
  rmSync(jalurSintetis, { force: true });
  rmSync(jalurTanpaKolom, { force: true });
}

// ===========================================================================
// Berkas yang tidak sah harus DITOLAK, bukan dibaca sebagian
// ===========================================================================

console.log("\n=== BAGIAN 4: berkas cacat ditolak dengan jelas ===");
const tolak = (nama, buf) => {
  try {
    bacaWorkbookRab(buf, { skenario: "1lokasi" });
    ok(nama, false, "TIDAK dilempar galat");
  } catch (e) {
    ok(nama, true, e.message);
  }
};
tolak("berkas bukan ZIP", Buffer.from("ini jelas bukan xlsx"));

// Satu byte dibalik DI DALAM data terkompresi xl/sharedStrings.xml. Tanpa
// pemeriksaan CRC, kerusakan seperti ini muncul sebagai teks yang berubah atau
// baris yang hilang -- terlihat seperti "isi sheet-nya memang begitu".
const NAMA_BAGIAN = "xl/sharedStrings.xml";
const posNama = isi.indexOf(NAMA_BAGIAN); // kemunculan pertama = header lokal
const rusak = Buffer.from(isi);
rusak[posNama + NAMA_BAGIAN.length + 80] ^= 0xff;
tolak("berkas .xlsx yang datanya rusak", rusak);

// Kerusakan yang TIDAK menggagalkan inflate: hanya CRC tersimpan yang diubah,
// jadi yang menolak berkas ini pasti pemeriksaan CRC kami, bukan node:zlib.
const posCd = isi.lastIndexOf(NAMA_BAGIAN); // kemunculan terakhir = direktori pusat
const crcRusak = Buffer.from(isi);
crcRusak[posCd - 46 + 16] ^= 0xff; // medan CRC-32 di header direktori pusat
tolak("CRC yang tidak cocok ditangkap pembaca kami", crcRusak);

// ===========================================================================
console.log(`\n=== RINGKASAN: ${lulus} lulus, ${gagal} gagal ===`);
process.exit(gagal === 0 ? 0 : 1);
