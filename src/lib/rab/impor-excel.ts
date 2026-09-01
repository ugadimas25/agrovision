/**
 * Pembaca berkas .xlsx untuk impor RAB -- fungsi murni, tanpa database, tanpa React.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MEMBACA XLSX SENDIRI, BUKAN MENAMBAH DEPENDENCY
 * ---------------------------------------------------------------------------
 * `src/lib/excel.ts` sudah menetapkan sikap repo ini: ekspor Excel ditulis
 * tanpa dependency sama sekali. Pembaca ini mengikuti sikap yang sama, dengan
 * tiga alasan yang bisa dipertanggungjawabkan:
 *
 * 1. Yang dibaca SEMPIT dan diketahui bentuknya: dua sheet, sel bertipe teks
 *    dan angka. Yang membuat pustaka xlsx besar -- gaya, format angka, tanggal,
 *    grafik, tabel pivot, penulisan kembali -- tidak satu pun dipakai di sini.
 *    Inti pembacaannya (§1-§3: ZIP, XML, sel) sekitar 250 baris kode dan bisa
 *    ditelaah satu duduk.
 * 2. Berkas ini dibaca dari UNGGAHAN PENGGUNA di dalam Server Action. Setiap
 *    baris parser adalah permukaan serang. Parser sendiri yang kecil dan
 *    fail-closed (lihat penjagaan Zip64/enkripsi/CRC di §1) lebih mudah
 *    ditelaah daripada dependency transitif sebuah pustaka spreadsheet.
 * 3. Pilihan (b) yang tersedia bukan pilihan yang enak: SheetJS versi npm sudah
 *    lama tidak diperbarui dan punya riwayat CVE prototype-pollution/ReDoS,
 *    sedangkan exceljs menyeret puluhan paket ke dalam image Cloud Run yang
 *    `output: "standalone"`.
 *
 * Harganya jelas dan sengaja dibayar: pembacaan sendiri hanya sah kalau
 * DIBUKTIKAN. Karena itu `db/verify-impor-excel.mjs` membandingkan SETIAP SEL
 * kedua sheet dengan pembacaan Python openpyxl, bukan sekadar mengecek beberapa
 * angka yang kelihatan benar. Angka anggaran yang salah baca adalah kegagalan
 * fatal di repo ini; "kelihatannya benar" tidak cukup.
 *
 * Yang SENGAJA tidak didukung (dan akan menggagalkan pembacaan dengan pesan
 * jelas, bukan diam-diam salah): Zip64, arsip berkata sandi, metode kompresi
 * selain store/deflate, dan .xls lama (BIFF, bukan ZIP sama sekali).
 * Keterbatasan yang diketahui: sel bertipe TANGGAL dikembalikan sebagai angka
 * serial Excel -- kedua sheet yang dibaca modul ini tidak punya kolom tanggal,
 * dan menebak zaman 1900/1904 di luar konteks itu justru mengarang data.
 *
 * ---------------------------------------------------------------------------
 * ATURAN YANG MENENTUKAN BENAR/SALAHNYA MODUL INI
 * ---------------------------------------------------------------------------
 * - Kolom dicari BERDASARKAN JUDULNYA, tidak pernah berdasarkan nomor kolom.
 *   Template bisa berubah, dan salah kolom berarti harga masuk ke volume.
 * - Kolom Total DIBACA tapi TIDAK PERNAH diimpor: `amount_idr` adalah kolom
 *   GENERATED (volume x harga satuan) di database sejak migrasi 0060. Total di
 *   sheet hanya dipakai sebagai pembanding; selisih > 1 rupiah dicatat sebagai
 *   Masalah, karena itu berarti sheet memakai rumus lain (pembulatan, kolom
 *   tersembunyi, sel yang ditimpa manual) dan pengguna harus tahu sebelum
 *   angkanya masuk.
 * - Sel kosong adalah `null` ("belum ada data", dirender em-dash), BUKAN 0.
 *   Nol yang memang tertulis 0 tetap 0 -- baris "Land acquisition/lease" di
 *   template sengaja Rp 0 sampai ada calon lahan, dan menghapus nol itu
 *   menghapus keputusannya.
 * - Tahap & penggerak dinormalkan ke daftar tertutup `src/lib/rab/daftar.ts`.
 *   Yang tidak ada di daftar menjadi `null` + satu Masalah. TIDAK ADA tebakan
 *   "yang paling mirip": menempatkan baris ke tahap yang salah lebih buruk
 *   daripada mengosongkannya, karena yang salah tidak terlihat salah.
 * - Nilai HASIL RUMUS dibedakan dari nilai yang diketik, dan jumlahnya
 *   dilaporkan sekali per sheet. Aplikasi punya mesin penurunan sendiri (0062);
 *   nilai rumus yang diimpor menjadi angka mati, dan itu harus disadari.
 * - 15_Checks dibaca dan STATUS MODEL-nya diteruskan apa adanya. Impor dari
 *   workbook yang pemeriksaannya gagal tidak ditolak -- itu keputusan pengguna
 *   -- tapi ia harus terlihat sebelum disimpan, bukan sesudah.
 * - Angka dalam bentuk teks dibaca hanya bila artinya PASTI. "1.000.000" pasti
 *   satu juta; "1.000" tidak pasti (seribu atau satu koma nol) dan karena itu
 *   ditolak, bukan ditebak. Lihat `bacaAngka()` di §4.
 */

import { inflateRawSync } from "node:zlib";
import { PENGGERAK, TAHAP } from "@/lib/rab/daftar";

// ===========================================================================
// Kontrak publik
// ===========================================================================

export type BarisImpor = {
  barisAsli: number; // nomor baris di sheet, untuk pesan galat
  uraian: string;
  tahap: string | null; // dinormalkan ke TAHAP; null bila tak dikenali
  penggerak: string | null; // dinormalkan ke PENGGERAK; null bila tak dikenali
  volume: number | null;
  satuanTeks: string | null; // teks apa adanya dari sheet ("ha", "lot", "site")
  hargaSatuan: number | null;
  sumberRef: string | null;
  totalDiSheet: number | null; // HANYA untuk dicocokkan, tidak pernah diimpor
  /** true bila nilai di sheet berasal dari rumus, bukan diketik orang. */
  volumeDariRumus: boolean;
  hargaDariRumus: boolean;
};

export type AsumsiImpor = {
  barisAsli: number;
  kelompok: string | null;
  variabel: string;
  nilai: number | null;
  satuan: string | null;
  idSumber: string | null;
  keyakinan: "high" | "medium" | "low" | null;
  catatan: string | null;
};

/** `baris: 0` berarti masalahnya bukan pada satu baris data (sheet/header). */
export type Masalah = { sheet: string; baris: number; pesan: string };

/**
 * Hasil 15_Checks. `status` adalah baris "STATUS MODEL" -- panduan berkasnya
 * (Panduan_Per_Sheet baris 27) menuntutnya PASS sebelum workbook dipakai.
 */
export type StatusModel = {
  status: string | null;
  gagal: { pemeriksaan: string; selisih: string | null }[];
};

export type HasilImpor = {
  asumsi: AsumsiImpor[];
  komponen: BarisImpor[];
  masalah: Masalah[];
  /**
   * Bulan MULAI paling awal per tahap, dari sheet 05_Workplan_Labor.
   *
   * 08_CAPEX_RAB tidak punya kolom bulan sama sekali, sehingga seluruh baris
   * hasil impor menumpuk di bulan ke-1 dan "sebaran per bulan" jadi satu batang
   * tunggal yang tidak berarti apa-apa. Jadwalnya ada, tapi di sheet lain --
   * ini menyediakannya sebagai SARAN, dipakai hanya bila pengguna menekan
   * tombolnya.
   *
   * Kuncinya nama tahap TANPA awalan huruf ("Land prep", bukan "B Land prep"),
   * karena kedua sheet menuliskannya berbeda.
   */
  jadwalTahap: Record<string, number>;
  /** Dari sheet 15_Checks. null bila sheet-nya tidak ada di berkas. */
  statusModel: StatusModel | null;
};

export const SHEET_KOMPONEN = "08_CAPEX_RAB";
export const SHEET_ASUMSI = "02_Assumptions";
export const SHEET_CEK = "15_Checks";
export const SHEET_JADWAL = "05_Workplan_Labor";

// ===========================================================================
// §1. ZIP -- .xlsx adalah arsip ZIP berisi XML
//
// Fail-closed di seluruh bagian ini. Berkas yang tidak bisa dipastikan utuh
// TIDAK dibaca sebagian: sheet yang terpotong terlihat seperti "RAB-nya memang
// cuma segini", bukan seperti berkas rusak.
// ===========================================================================

const TANDA_EOCD = 0x06054b50;
const TANDA_CD = 0x02014b50;
const TANDA_LOKAL = 0x04034b50;

const TABEL_CRC32 = (() => {
  const tabel = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabel[n] = c >>> 0;
  }
  return tabel;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABEL_CRC32[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type EntriZip = {
  metode: number;
  crc: number;
  ukuranTerkompresi: number;
  ukuranAsli: number;
  offsetLokal: number;
};

/** Arsip yang sudah diindeks; isinya baru didekompresi saat diminta. */
type Arsip = { baca: (nama: string) => Uint8Array | null };

function bukaZip(data: Uint8Array): Arsip {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // EOCD ada di ekor berkas, digeser komentar arsip (maksimal 65535 byte).
  let eocd = -1;
  for (let i = data.length - 22, batas = Math.max(0, data.length - 22 - 0xffff); i >= batas; i--) {
    if (dv.getUint32(i, true) === TANDA_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Berkas ini bukan .xlsx: penanda akhir arsip ZIP tidak ditemukan.");
  }

  const jumlahEntri = dv.getUint16(eocd + 10, true);
  const ukuranCd = dv.getUint32(eocd + 12, true);
  const offsetCd = dv.getUint32(eocd + 16, true);
  if (jumlahEntri === 0xffff || ukuranCd === 0xffffffff || offsetCd === 0xffffffff) {
    throw new Error("Arsip ZIP memakai format Zip64; pembaca ini sengaja tidak mendukungnya.");
  }

  const indeks = new Map<string, EntriZip>();
  const teks = new TextDecoder("utf-8");
  let p = offsetCd;
  for (let i = 0; i < jumlahEntri; i++) {
    if (p + 46 > data.length || dv.getUint32(p, true) !== TANDA_CD) {
      throw new Error("Direktori pusat arsip ZIP rusak; berkas tidak dibaca sebagian.");
    }
    const bendera = dv.getUint16(p + 8, true);
    if (bendera & 0x1) throw new Error("Berkas .xlsx terkunci kata sandi; tidak bisa dibaca.");
    const panjangNama = dv.getUint16(p + 28, true);
    const panjangEkstra = dv.getUint16(p + 30, true);
    const panjangKomentar = dv.getUint16(p + 32, true);
    const nama = teks.decode(data.subarray(p + 46, p + 46 + panjangNama));
    indeks.set(nama, {
      metode: dv.getUint16(p + 10, true),
      crc: dv.getUint32(p + 16, true),
      ukuranTerkompresi: dv.getUint32(p + 20, true),
      ukuranAsli: dv.getUint32(p + 24, true),
      offsetLokal: dv.getUint32(p + 42, true),
    });
    p += 46 + panjangNama + panjangEkstra + panjangKomentar;
  }

  const baca = (nama: string): Uint8Array | null => {
    const e = indeks.get(nama);
    if (!e) return null;
    const o = e.offsetLokal;
    if (o + 30 > data.length || dv.getUint32(o, true) !== TANDA_LOKAL) {
      throw new Error(`Header lokal ZIP untuk "${nama}" rusak.`);
    }
    // Panjang nama/ekstra DI HEADER LOKAL boleh berbeda dari yang di direktori
    // pusat -- keduanya harus dibaca dari tempatnya masing-masing.
    const awal = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
    const mentah = data.subarray(awal, awal + e.ukuranTerkompresi);
    let isi: Uint8Array;
    if (e.metode === 0) isi = mentah;
    else if (e.metode === 8) isi = new Uint8Array(inflateRawSync(mentah));
    else throw new Error(`Metode kompresi ZIP ${e.metode} pada "${nama}" tidak didukung.`);

    if (isi.length !== e.ukuranAsli) {
      throw new Error(`Isi "${nama}" tidak utuh: ${isi.length} byte, seharusnya ${e.ukuranAsli}.`);
    }
    // CRC dari arsip. Ini yang membedakan "berkas rusak" dari "datanya memang
    // segini" -- unggahan yang terpotong di tengah jalan gagal DI SINI, bukan
    // nanti sebagai RAB yang kehilangan sepuluh baris terakhir tanpa jejak.
    if (crc32(isi) !== e.crc) throw new Error(`CRC "${nama}" tidak cocok; berkas rusak.`);
    return isi;
  };

  return { baca };
}

// ===========================================================================
// §2. XML secukupnya
//
// Bukan parser XML umum: hanya elemen yang dipakai SpreadsheetML, dengan
// asumsi yang berlaku untuk berkas hasil Excel/LibreOffice/openpyxl (atribut
// selalu dikutip, isi teks selalu di-escape).
// ===========================================================================

function dekodeXml(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (utuh: string, des?: string, heks?: string, nama?: string) => {
      if (des !== undefined) return String.fromCodePoint(Number(des));
      if (heks !== undefined) return String.fromCodePoint(parseInt(heks, 16));
      switch (nama) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return utuh;
      }
    },
  );
}

function atribut(tag: string, nama: string): string | null {
  const m = new RegExp(`\\s${nama}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (!m) return null;
  return dekodeXml(m[2] ?? m[3] ?? "");
}

/** Semua `<t>` di dalam potongan XML, minus teks fonetik (`<rPh>`). */
function teksDariRuns(isi: string): string {
  const tanpaFonetik = isi.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of tanpaFonetik.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    out += dekodeXml(m[1] ?? "");
  }
  return out;
}

// ===========================================================================
// §3. Workbook -> lembar -> sel
// ===========================================================================

export type NilaiSel = string | number | boolean | null;

export type LembarMentah = {
  nama: string;
  barisMaks: number;
  kolomMaks: number;
  /** Baris & kolom 1-basis, seperti yang dilihat pengguna di Excel. */
  sel: (baris: number, kolom: number) => NilaiSel;
  /**
   * true bila sel itu RUMUS (punya elemen <f>), bukan angka yang diketik.
   * Nilainya sendiri tetap yang ter-cache di <v>; ini hanya menjawab "dari mana
   * angka ini datang", yang di 08_CAPEX_RAB adalah pertanyaan penting: panduan
   * berkasnya menyebut sheet itu "menarik jumlah dan harga dari 02, 04, 05, 06,
   * 14, dan 17", jadi sebagian besar angkanya turunan, bukan ketikan.
   */
  rumus: (baris: number, kolom: number) => boolean;
};

const KOLOM_MAKS_XLSX = 16384;
const kunciSel = (baris: number, kolom: number) => baris * KOLOM_MAKS_XLSX + kolom;

/** "AA12" -> { baris: 12, kolom: 27 } */
function uraikanRefSel(ref: string): { baris: number; kolom: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let kolom = 0;
  const huruf = m[1].toUpperCase();
  for (let i = 0; i < huruf.length; i++) kolom = kolom * 26 + (huruf.charCodeAt(i) - 64);
  return { baris: Number(m[2]), kolom };
}

function bacaSharedStrings(xml: string): string[] {
  const hasil: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    hasil.push(teksDariRuns(m[1] ?? ""));
  }
  return hasil;
}

function bacaLembar(nama: string, xml: string, shared: string[]): LembarMentah {
  const sel = new Map<number, NilaiSel>();
  const selRumus = new Set<number>();
  let barisMaks = 0;
  let kolomMaks = 0;

  // Hanya di dalam <sheetData>; sisanya (mergeCells, conditionalFormatting,
  // dataValidations) tidak berisi sel dan tidak perlu ditelusuri.
  const awal = xml.indexOf("<sheetData");
  const akhir = xml.indexOf("</sheetData>");
  const isi = awal < 0 || akhir < 0 ? "" : xml.slice(awal, akhir);

  for (const mBaris of isi.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rBaris = atribut(mBaris[1], "r");
    // Nomor baris eksplisit bila ada; kalau tidak, lanjut dari baris sebelumnya.
    let nomorBaris = rBaris ? Number(rBaris) : barisMaks + 1;
    if (!Number.isFinite(nomorBaris) || nomorBaris < 1) nomorBaris = barisMaks + 1;
    let kolomBerjalan = 0;

    for (const mSel of (mBaris[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tagSel = mSel[1];
      const isiSel = mSel[2] ?? "";
      const ref = atribut(tagSel, "r");
      const pos = ref ? uraikanRefSel(ref) : null;
      // Kolom yang dilewati tidak muncul di XML sama sekali -- posisi HARUS
      // datang dari atribut r, bukan dari urutan kemunculan.
      const kolom = pos ? pos.kolom : kolomBerjalan + 1;
      if (pos) nomorBaris = pos.baris;
      kolomBerjalan = kolom;

      const jenis = atribut(tagSel, "t") ?? "n";
      const mV = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(isiSel);
      const v = mV ? dekodeXml(mV[1] ?? "") : null;

      let nilai: NilaiSel = null;
      if (jenis === "s") {
        // Sel rumus pun menyimpan nilai ter-cache di <v>; itu yang dipakai.
        const i = v === null ? NaN : Number(v);
        nilai = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i] : null;
      } else if (jenis === "inlineStr") {
        const mIs = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(isiSel);
        nilai = mIs ? teksDariRuns(mIs[1]) : null;
      } else if (jenis === "str" || jenis === "e" || jenis === "d") {
        nilai = v;
      } else if (jenis === "b") {
        nilai = v === null ? null : v !== "0";
      } else {
        // "n" atau tanpa atribut t. <c/> tanpa <v> = sel yang hanya bergaya.
        if (v !== null && v.trim() !== "") {
          const angka = Number(v);
          nilai = Number.isNaN(angka) ? v : angka;
        }
      }

      // Penanda rumus dicatat TERPISAH dari nilainya: sel rumus yang belum
      // pernah dihitung tidak punya <v> sama sekali, dan justru sel seperti
      // itulah yang paling perlu dikenali -- tanpa ini ia hanya tampak sebagai
      // sel kosong biasa. <f>, <f .../>, dan <f t="shared" si="0"/> sama saja.
      const kunci = kunciSel(nomorBaris, kolom);
      const adaRumus = /<f[\s/>]/.test(isiSel);
      if (adaRumus) selRumus.add(kunci);
      if (nilai !== null && nilai !== "") sel.set(kunci, nilai);
      if (adaRumus || (nilai !== null && nilai !== "")) {
        if (nomorBaris > barisMaks) barisMaks = nomorBaris;
        if (kolom > kolomMaks) kolomMaks = kolom;
      }
    }
    if (nomorBaris > barisMaks) barisMaks = nomorBaris;
  }

  // Sel yang TERTUTUP penggabungan dikosongkan; hanya sel kiri-atas yang
  // benar-benar terlihat di Excel. Sel lain di dalam rentang gabungan bisa
  // masih menyimpan nilai lama dari SEBELUM digabung, dan nilai itu tidak
  // terlihat oleh siapa pun yang membuka berkasnya. Pada template R2,
  // 19_Optimasi_10Tahun baris 27 menyimpan tiga teks seperti itu di balik
  // gabungan A27:L27. Mengimpornya berarti memasukkan angka yang tidak ada di
  // layar -- persis jenis kesalahan yang tidak akan pernah ada yang menyadari.
  //
  // Yang ditelusuri adalah SEL YANG ADA, bukan seluruh petak rentangnya: satu
  // <mergeCell ref="A1:XFD1048576"/> di berkas kiriman akan membuat penelusuran
  // per-petak berjalan belasan miliar kali.
  const rentang: { atas: number; kiri: number; bawah: number; kanan: number }[] = [];
  const mGabung = /<mergeCells\b[^>]*?(?:\/>|>([\s\S]*?)<\/mergeCells>)/.exec(xml);
  for (const m of (mGabung?.[1] ?? "").matchAll(/<mergeCell\b([^>]*?)(?:\/>|>[\s\S]*?<\/mergeCell>)/g)) {
    const ref = atribut(m[1], "ref");
    if (!ref) continue;
    const [refAwal, refAkhir] = ref.split(":");
    const p1 = uraikanRefSel(refAwal ?? "");
    const p2 = uraikanRefSel(refAkhir ?? refAwal ?? "");
    if (!p1 || !p2) continue;
    rentang.push({
      atas: Math.min(p1.baris, p2.baris),
      kiri: Math.min(p1.kolom, p2.kolom),
      bawah: Math.max(p1.baris, p2.baris),
      kanan: Math.max(p1.kolom, p2.kolom),
    });
  }
  if (rentang.length > 0) {
    for (const kunci of [...sel.keys()]) {
      const baris = Math.floor(kunci / KOLOM_MAKS_XLSX);
      const kolom = kunci - baris * KOLOM_MAKS_XLSX;
      for (const r of rentang) {
        if (baris < r.atas || baris > r.bawah || kolom < r.kiri || kolom > r.kanan) continue;
        if (baris !== r.atas || kolom !== r.kiri) {
          sel.delete(kunci);
          selRumus.delete(kunci);
        }
        break;
      }
    }
  }

  return {
    nama,
    barisMaks,
    kolomMaks,
    sel: (baris, kolom) => sel.get(kunciSel(baris, kolom)) ?? null,
    rumus: (baris, kolom) => selRumus.has(kunciSel(baris, kolom)),
  };
}

function keUint8(buf: Buffer | ArrayBuffer): Uint8Array {
  return buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Membuka workbook dan mengembalikan lembar apa adanya, tanpa pemetaan kolom.
 * Dipakai `db/verify-impor-excel.mjs` untuk membandingkan sel-per-sel dengan
 * openpyxl -- pembacaan mentah harus bisa diuji terpisah dari penafsirannya.
 */
export function bukaWorkbookMentah(buf: Buffer | ArrayBuffer): Map<string, LembarMentah> {
  const zip = bukaZip(keUint8(buf));
  const teks = new TextDecoder("utf-8");
  const ambilTeks = (nama: string): string | null => {
    const b = zip.baca(nama);
    return b ? teks.decode(b) : null;
  };

  const xmlWb = ambilTeks("xl/workbook.xml");
  if (!xmlWb) throw new Error("Bukan berkas .xlsx yang sah: xl/workbook.xml tidak ada.");
  const xmlRels = ambilTeks("xl/_rels/workbook.xml.rels") ?? "";

  // r:id -> target. Urutan rId di dalam rels TIDAK sama dengan urutan sheet,
  // dan nama berkas sheetN.xml TIDAK sama dengan nomor urut sheet. Pada
  // template Banyumas, 08_CAPEX_RAB adalah sheet ke-10 dengan sheetId 9 dan
  // berkas worksheets/sheet10.xml; menebak salah satu dari ketiganya berarti
  // membaca sheet yang sama sekali lain.
  const target = new Map<string, string>();
  for (const m of xmlRels.matchAll(/<Relationship\b([^>]*)>/g)) {
    const id = atribut(m[1], "Id");
    const t = atribut(m[1], "Target");
    if (id && t) target.set(id, t);
  }

  const shared = bacaSharedStrings(ambilTeks("xl/sharedStrings.xml") ?? "");

  const lembar = new Map<string, LembarMentah>();
  const mSheets = /<sheets\b[^>]*>([\s\S]*?)<\/sheets>/.exec(xmlWb);
  for (const m of (mSheets?.[1] ?? "").matchAll(/<sheet\b([^>]*)>/g)) {
    const nama = atribut(m[1], "name");
    const rid = atribut(m[1], "r:id") ?? atribut(m[1], "id");
    if (!nama || !rid) continue;
    const t = target.get(rid);
    if (!t) continue;
    const jalur = t.startsWith("/") ? t.slice(1) : t.startsWith("../") ? t.slice(3) : `xl/${t}`;
    const xml = ambilTeks(jalur);
    if (xml === null) continue;
    lembar.set(nama, bacaLembar(nama, xml, shared));
  }
  return lembar;
}

// ===========================================================================
// §4. Membaca teks & angka dari sel
// ===========================================================================

/**
 * Spasi "tak terlihat" yang ikut tersalin saat orang menempel dari Word/PDF ke
 * Excel: NBSP, figure space, narrow NBSP, dan BOM. Tanpa disamakan dengan
 * spasi biasa, judul kolom "Harga satuan" bisa tidak cocok dengan dirinya
 * sendiri dan seluruh kolom harga dianggap hilang.
 */
const SPASI_ANEH = /[\u00a0\u2007\u202f\ufeff]/g;

/** Huruf kecil, tanpa spasi berlebih, spasi aneh disamakan dengan spasi biasa. */
function normal(s: string): string {
  return s.replace(SPASI_ANEH, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function bacaTeks(sel: NilaiSel): string | null {
  if (sel === null) return null;
  if (typeof sel === "string") {
    const t = sel.replace(SPASI_ANEH, " ").trim();
    return t === "" ? null : t;
  }
  if (typeof sel === "boolean") return sel ? "TRUE" : "FALSE";
  return String(sel);
}

type BacaanAngka =
  | { jenis: "kosong" }
  | { jenis: "angka"; nilai: number }
  | { jenis: "tolak"; alasan: string };

/** Apakah `t` terbaca sebagai angka berkelompok ribuan dengan pemisah `sep`? */
function polaRibuan(t: string, sep: string): boolean {
  return (sep === "." ? /^\d{1,3}(?:\.\d{3})+$/ : /^\d{1,3}(?:,\d{3})+$/).test(t);
}

/**
 * Angka dari sel yang bisa berupa angka asli maupun teks.
 *
 * Yang diterima hanya yang artinya PASTI di kedua konvensi (Indonesia dan
 * Inggris). Yang ambigu ditolak dengan menyebut ambiguitasnya -- mengarang
 * angka anggaran adalah kegagalan fatal, dan "1.000" memang bisa berarti dua
 * hal yang selisihnya seribu kali lipat.
 */
function bacaAngka(sel: NilaiSel): BacaanAngka {
  if (sel === null) return { jenis: "kosong" };
  if (typeof sel === "number") {
    return Number.isFinite(sel)
      ? { jenis: "angka", nilai: sel }
      : { jenis: "tolak", alasan: "nilai numerik tidak terhingga" };
  }
  if (typeof sel === "boolean") return { jenis: "tolak", alasan: "berisi TRUE/FALSE, bukan angka" };

  const asli = sel.trim();
  let t = sel.replace(SPASI_ANEH, " ").trim();
  if (t === "") return { jenis: "kosong" };

  // (1.000) = -1000, format akuntansi.
  let negatif = false;
  const kurung = /^\((.*)\)$/.exec(t);
  if (kurung) {
    negatif = true;
    t = kurung[1].trim();
  }

  // Hanya token mata uang yang dikenali yang boleh dibuang; sisanya harus
  // murni angka. Membuang "huruf apa saja" akan mengubah "5 juta" jadi 5.
  t = t.replace(/^(?:rp\.?|idr)\s*/i, "").replace(/\s*(?:rp\.?|idr)$/i, "").trim();

  if (/^[-−]/.test(t)) {
    negatif = !negatif;
    t = t.slice(1).trim();
  } else if (t.startsWith("+")) {
    t = t.slice(1).trim();
  }

  if (t.includes("%")) {
    return { jenis: "tolak", alasan: `"${asli}" memakai tanda persen; 5% bisa berarti 5 atau 0,05` };
  }

  t = t.replace(/\s+/g, ""); // "1 000 000" -> "1000000"
  if (t === "" || !/^[0-9.,]+$/.test(t)) {
    return { jenis: "tolak", alasan: `"${asli}" bukan angka yang bisa dibaca pasti` };
  }

  const jumlahTitik = (t.match(/\./g) ?? []).length;
  const jumlahKoma = (t.match(/,/g) ?? []).length;
  let bersih: string;

  if (jumlahTitik > 0 && jumlahKoma > 0) {
    // Dua jenis pemisah sekaligus: yang TERAKHIR pasti desimal.
    const desimal = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const ribuan = desimal === "." ? "," : ".";
    const potong = t.split(desimal);
    if (potong.length !== 2 || !polaRibuan(potong[0], ribuan) || !/^\d+$/.test(potong[1])) {
      return { jenis: "tolak", alasan: `"${asli}" bukan format angka yang dikenali` };
    }
    bersih = potong[0].split(ribuan).join("") + "." + potong[1];
  } else if (jumlahTitik + jumlahKoma === 0) {
    bersih = t;
  } else {
    const sep = jumlahTitik > 0 ? "." : ",";
    const jumlah = jumlahTitik + jumlahKoma;
    if (polaRibuan(t, sep)) {
      // Pemisah desimal tidak pernah muncul dua kali -> pasti ribuan.
      if (jumlah >= 2) bersih = t.split(sep).join("");
      // Muncul sekali dan tepat 3 digit di belakang: "1.000" bisa berarti
      // seribu (id-ID) atau satu koma nol (en-US). Ditolak, bukan ditebak.
      else {
        return {
          jenis: "tolak",
          alasan: `"${asli}" ambigu: "${sep}" bisa berarti pemisah ribuan atau koma desimal`,
        };
      }
    } else if (jumlah === 1 && /^\d*[.,]\d+$/.test(t)) {
      bersih = t.replace(sep, "."); // kelompok ribuan selalu 3 digit -> ini desimal
    } else {
      return { jenis: "tolak", alasan: `"${asli}" bukan format angka yang dikenali` };
    }
  }

  const nilai = Number(bersih);
  if (!Number.isFinite(nilai)) return { jenis: "tolak", alasan: `"${asli}" bukan angka yang bisa dibaca pasti` };
  return { jenis: "angka", nilai: negatif ? -nilai : nilai };
}

// ===========================================================================
// §5. Mencari kolom berdasarkan JUDULNYA
// ===========================================================================

const petaTahap = new Map(TAHAP.map((t) => [normal(t), t as string]));
const petaPenggerak = new Map(PENGGERAK.map((p) => [normal(p), p as string]));

/**
 * Tingkat keyakinan -> enum `app.assumption_confidence`.
 *
 * Daftar TERTUTUP dan diterjemahkan satu-satu, bukan pencocokan mirip-miripan.
 * Ejaan Indonesia ikut diterima karena template R2 memakainya pada 47 baris
 * (Tinggi/Sedang/Rendah) berdampingan dengan High/Medium/Low di baris lain;
 * membuang 47 penilaian keyakinan yang tertulis jelas di sheet justru
 * membuang informasi yang paling ingin dipertahankan migrasi 0061 §4.
 */
const PETA_KEYAKINAN: Record<string, "high" | "medium" | "low"> = {
  high: "high",
  tinggi: "high",
  medium: "medium",
  sedang: "medium",
  low: "low",
  rendah: "low",
};

type Alias = { kunci: string; judul: string[]; wajib: boolean };

const KOLOM_KOMPONEN: Alias[] = [
  { kunci: "tahap", judul: ["tahap", "stage"], wajib: true },
  { kunci: "uraian", judul: ["uraian", "deskripsi", "description", "item"], wajib: true },
  { kunci: "penggerak", judul: ["penggerak", "driver"], wajib: true },
  { kunci: "volume1", judul: ["jumlah 1 lokasi", "jumlah 1 site", "qty 1 lokasi"], wajib: false },
  { kunci: "volume4", judul: ["jumlah 4 lokasi", "jumlah 4 site", "qty 4 lokasi"], wajib: false },
  { kunci: "satuan", judul: ["satuan", "unit", "uom"], wajib: true },
  { kunci: "harga", judul: ["harga satuan", "unit price", "harga/satuan"], wajib: true },
  { kunci: "total1", judul: ["total 1 lokasi", "total 1 site"], wajib: false },
  { kunci: "total4", judul: ["total 4 lokasi", "total 4 site"], wajib: false },
  {
    kunci: "sumber",
    judul: ["dasar/sumber/pengecualian", "dasar sumber pengecualian", "dasar/sumber", "sumber", "source"],
    wajib: true,
  },
];

const KOLOM_ASUMSI: Alias[] = [
  { kunci: "kelompok", judul: ["kelompok", "group", "grup", "kategori"], wajib: true },
  { kunci: "variabel", judul: ["variabel", "variable", "input", "parameter"], wajib: true },
  { kunci: "nilai", judul: ["nilai", "value"], wajib: true },
  { kunci: "satuan", judul: ["satuan", "unit", "uom"], wajib: true },
  { kunci: "idSumber", judul: ["id sumber", "source id", "id source", "sumber", "source"], wajib: true },
  { kunci: "keyakinan", judul: ["tingkat keyakinan", "confidence", "confidence level", "keyakinan"], wajib: true },
  { kunci: "catatan", judul: ["catatan", "keterangan", "note", "notes"], wajib: true },
];

type Header = { baris: number; kolom: Map<string, number>; ganda: string[] };

/**
 * Mencari baris header dengan menelusuri sel, bukan dengan menghafal nomor
 * baris: pada template R2 header CAPEX ada di baris 4 dan header asumsi di
 * baris 5, dan angka itu tidak dijanjikan bertahan pada revisi berikutnya.
 */
function cariHeader(lembar: LembarMentah, alias: Alias[], penanda: string[], maksBaris: number): Header | null {
  const semuaJudul = new Set(alias.flatMap((a) => a.judul));
  const batas = Math.min(lembar.barisMaks, maksBaris);
  const kolomMaks = Math.max(lembar.kolomMaks, 1);

  for (let baris = 1; baris <= batas; baris++) {
    const judulDiBaris = new Map<string, number>();
    for (let kolom = 1; kolom <= kolomMaks; kolom++) {
      const t = bacaTeks(lembar.sel(baris, kolom));
      if (t === null) continue;
      const n = normal(t).replace(/[:*]+$/, "");
      if (semuaJudul.has(n) && !judulDiBaris.has(n)) judulDiBaris.set(n, kolom);
    }
    if (!penanda.every((p) => judulDiBaris.has(p))) continue;

    const kolom = new Map<string, number>();
    const ganda: string[] = [];
    for (const a of alias) {
      const cocok = a.judul.filter((j) => judulDiBaris.has(j));
      if (cocok.length === 0) continue;
      if (cocok.length > 1) ganda.push(a.kunci);
      kolom.set(a.kunci, judulDiBaris.get(cocok[0]) as number);
    }
    return { baris, kolom, ganda };
  }
  return null;
}

/**
 * Kolom wajib yang tidak ketemu dilaporkan SEKALI di sini, bukan puluhan kali
 * per baris. Tanpa laporan ini, kolom yang berganti nama akan menghasilkan RAB
 * yang setiap barisnya kehilangan tahap (atau sumber, atau satuan) tanpa satu
 * pun tanda bahwa yang hilang adalah kolomnya, bukan datanya.
 */
function laporkanKolomHilang(header: Header, alias: Alias[], sheet: string, masalah: Masalah[]): void {
  for (const a of alias) {
    if (!a.wajib || header.kolom.has(a.kunci)) continue;
    masalah.push({
      sheet,
      baris: header.baris,
      pesan: `Kolom "${a.judul[0].charAt(0).toUpperCase()}${a.judul[0].slice(1)}" tidak ada di baris header; isian itu dikosongkan untuk seluruh baris.`,
    });
  }
  for (const kunci of header.ganda) {
    masalah.push({
      sheet,
      baris: header.baris,
      pesan: `Lebih dari satu kolom cocok untuk "${kunci}"; yang paling kiri yang dipakai.`,
    });
  }
}

/** Baris yang mengulang judul header (tiap seksi 02_Assumptions memulainya lagi). */
function barisUlanganHeader(lembar: LembarMentah, baris: number, alias: Alias[], kolomMaks: number): boolean {
  const semuaJudul = new Set(alias.flatMap((a) => a.judul));
  let cocok = 0;
  for (let kolom = 1; kolom <= kolomMaks; kolom++) {
    const t = bacaTeks(lembar.sel(baris, kolom));
    if (t !== null && semuaJudul.has(normal(t).replace(/[:*]+$/, ""))) cocok++;
  }
  return cocok >= 3;
}

// ===========================================================================
// §6. Pemetaan dua sheet
// ===========================================================================

function cariLembar(wb: Map<string, LembarMentah>, nama: string): LembarMentah | null {
  const langsung = wb.get(nama);
  if (langsung) return langsung;
  const n = normal(nama);
  for (const [k, v] of wb) if (normal(k) === n) return v;
  return null;
}

/**
 * Satu Masalah RINGKAS per sheet tentang berapa banyak nilai yang ternyata
 * hasil rumus, bukan ketikan orang.
 *
 * Kenapa ini dilaporkan sama sekali: aplikasi punya mesin penurunannya sendiri
 * (asumsi + basis_code x ratio_per_basis, migrasi 0062). Nilai yang di Excel
 * ikut bergerak saat luas atau jumlah lokasi diubah, begitu diimpor menjadi
 * ANGKA MATI di app.budget_plan_items.volume. Itu tidak salah -- tapi pengguna
 * harus tahu bahwa yang ia impor adalah potret satu skenario, bukan modelnya.
 * Persis bahaya "RAB setengah berubah" yang jadi alasan 0062 ada.
 *
 * Satu baris per sheet, bukan per baris data: 36 dari 36 volume di 08_CAPEX_RAB
 * adalah rumus, dan 36 pesan yang sama hanya akan menenggelamkan Masalah yang
 * benar-benar menuntut tindakan.
 */
/**
 * Sel RUMUS yang kosong hampir selalu berarti hal lain daripada sel kosong
 * biasa: berkasnya ditulis alat yang tidak menyimpan hasil hitungan (openpyxl,
 * sebagian eksportir), sehingga rumusnya ada tapi nilainya tidak pernah ada.
 * "Tidak punya volume" akan menyuruh pengguna mengisi sel yang di layarnya
 * terlihat berangka; yang benar adalah membuka dan menyimpan ulang di Excel.
 */
function pesanAngkaGagal(
  b: { jenis: "kosong" } | { jenis: "tolak"; alasan: string },
  apa: string,
  uraian: string,
  dariRumus: boolean,
): string {
  if (b.jenis === "tolak") return `${apa} "${uraian}" tidak terbaca: ${b.alasan}.`;
  if (dariRumus) {
    return (
      `${apa} "${uraian}" berupa rumus yang belum pernah dihitung, jadi berkasnya ` +
      `tidak menyimpan nilai apa pun. Buka dan simpan ulang di Excel lebih dulu.`
    );
  }
  return `"${uraian}" tidak punya ${apa.toLowerCase()}; baris ini tidak bisa dihitung.`;
}

function laporkanNilaiRumus(
  sheet: string,
  jumlahBaris: number,
  masalah: Masalah[],
  bagian: { apa: string; jumlah: number }[],
): void {
  const berisi = bagian.filter((b) => b.jumlah > 0);
  if (berisi.length === 0) return;
  const rincian = berisi.map((b) => `${b.jumlah} dari ${jumlahBaris} ${b.apa}`).join(" dan ");
  masalah.push({
    sheet,
    baris: 0,
    pesan:
      `${rincian} berasal dari rumus, bukan angka yang diketik. Nilainya diimpor ` +
      `apa adanya sebagai angka tetap dan TIDAK ikut berubah bila asumsinya diubah kemudian.`,
  });
}

/**
 * 15_Checks: pemeriksaan internal model, padanan app.check_*() di repo ini.
 *
 * Panduan berkasnya sendiri (Panduan_Per_Sheet baris 27) menuliskan aturannya:
 * "STATUS MODEL harus PASS sebelum workbook digunakan". Impor dari workbook
 * yang pemeriksaannya sendiri gagal TIDAK ditolak di sini -- itu keputusan
 * pengguna -- tetapi ia harus melihatnya sebelum menekan simpan, bukan sesudah
 * angkanya masuk.
 *
 * Sheet ini punya DUA tabel pemeriksaan dengan judul kolom berbeda (baris 4
 * "Toleransi/Lokasi perbaikan", baris 26 "Penjelasan/Tindakan"), jadi setiap
 * baris header dicari lagi, bukan hanya yang pertama.
 */
const STATUS_LULUS = new Set(["pass", "ok", "lulus", "sesuai"]);

/**
 * Bulan mulai per tahap dari 05_Workplan_Labor.
 *
 * Sheet itu memuat DUA tabel. Yang pertama (Tahap | Aktivitas | Mulai | Selesai)
 * berisi bulan; yang kedua (Aktivitas | T1 | T2 | ...) berisi HOK tahunan, dan
 * kolom yang secara posisi sama dengan "Mulai" di sana berisi angka seperti
 * 7.761,6. Membaca sheet ini tanpa membatasi tabelnya akan menghasilkan "bulan
 * ke-7761" yang lolos begitu saja ke RAB.
 *
 * Karena itu pembacaan berhenti pada baris pertama yang tidak lagi berbentuk
 * baris data tabel pertama: kolom Aktivitas kosong (baris TOTAL/judul bagian),
 * atau Mulai bukan bilangan bulat 1..120.
 */
function bacaJadwalTahap(wb: Map<string, LembarMentah>): Record<string, number> {
  const lembar = cariLembar(wb, SHEET_JADWAL);
  if (!lembar) return {};

  let hBaris = 0;
  let kTahap = 0;
  let kAktivitas = 0;
  let kMulai = 0;
  for (let baris = 1; baris <= lembar.barisMaks && !hBaris; baris++) {
    let a = 0;
    let b = 0;
    let c = 0;
    for (let kolom = 1; kolom <= lembar.kolomMaks; kolom++) {
      const t = bacaTeks(lembar.sel(baris, kolom));
      if (t === null) continue;
      const n = normal(t);
      if (!a && n === "tahap") a = kolom;
      else if (!b && (n === "aktivitas" || n === "activity")) b = kolom;
      else if (!c && (n === "mulai" || n === "start")) c = kolom;
    }
    if (a && b && c) { hBaris = baris; kTahap = a; kAktivitas = b; kMulai = c; }
  }
  if (!hBaris) return {};

  const jadwal: Record<string, number> = {};
  for (let baris = hBaris + 1; baris <= lembar.barisMaks; baris++) {
    const tahap = bacaTeks(lembar.sel(baris, kTahap));
    const aktivitas = bacaTeks(lembar.sel(baris, kAktivitas));
    const mulai = lembar.sel(baris, kMulai);
    if (!tahap || !aktivitas) break;                       // baris TOTAL / judul bagian
    if (typeof mulai !== "number" || !Number.isInteger(mulai) || mulai < 1 || mulai > 120) break;
    // Kunci tanpa awalan huruf tahap: 08 menulis "B Land prep", 05 "Land prep".
    const kunci = normal(tahap).replace(/^[a-z]\s+/, "");
    if (!(kunci in jadwal) || mulai < jadwal[kunci]) jadwal[kunci] = mulai;
  }
  return jadwal;
}

function bacaStatusModel(wb: Map<string, LembarMentah>): StatusModel | null {
  const lembar = cariLembar(wb, SHEET_CEK);
  if (!lembar) return null;

  const judulPemeriksaan = ["pemeriksaan", "check", "uji"];
  const judulStatus = ["status"];
  const judulSelisih = ["selisih", "delta", "difference"];

  // Semua baris header di sheet ini, beserta kolomnya masing-masing.
  const header: { baris: number; pemeriksaan: number; status: number; selisih: number | null }[] = [];
  for (let baris = 1; baris <= lembar.barisMaks; baris++) {
    let kPemeriksaan = 0;
    let kStatus = 0;
    let kSelisih = 0;
    for (let kolom = 1; kolom <= lembar.kolomMaks; kolom++) {
      const t = bacaTeks(lembar.sel(baris, kolom));
      if (t === null) continue;
      const n = normal(t).replace(/[:*]+$/, "");
      if (!kPemeriksaan && judulPemeriksaan.includes(n)) kPemeriksaan = kolom;
      else if (!kStatus && judulStatus.includes(n)) kStatus = kolom;
      else if (!kSelisih && judulSelisih.includes(n)) kSelisih = kolom;
    }
    if (kPemeriksaan && kStatus) {
      header.push({ baris, pemeriksaan: kPemeriksaan, status: kStatus, selisih: kSelisih || null });
    }
  }
  if (header.length === 0) return { status: null, gagal: [] };

  let status: string | null = null;
  const gagal: { pemeriksaan: string; selisih: string | null }[] = [];

  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    const batas = i + 1 < header.length ? header[i + 1].baris : lembar.barisMaks + 1;
    for (let baris = h.baris + 1; baris < batas; baris++) {
      const pemeriksaan = bacaTeks(lembar.sel(baris, h.pemeriksaan));
      const teksStatus = bacaTeks(lembar.sel(baris, h.status));
      if (pemeriksaan === null) continue;

      // Baris "STATUS MODEL" adalah kesimpulan sheet, bukan satu pemeriksaan.
      if (normal(pemeriksaan) === "status model") {
        status = teksStatus ?? bacaTeks(lembar.sel(baris, h.status + 1));
        continue;
      }
      // Bagian "Peringatan yang tidak menggagalkan rumus" berisi kalimat tanpa
      // status; itu catatan, bukan pemeriksaan yang bisa lulus atau gagal.
      if (teksStatus === null) continue;

      // OK dan PASS sama-sama berarti lulus: tabel pertama memakai "OK" untuk
      // tiap baris dan menyimpan "PASS" hanya untuk STATUS MODEL.
      if (STATUS_LULUS.has(normal(teksStatus))) continue;
      gagal.push({
        pemeriksaan,
        selisih: h.selisih === null ? null : bacaTeks(lembar.sel(baris, h.selisih)),
      });
    }
  }
  return { status, gagal };
}

function petakanKomponen(
  wb: Map<string, LembarMentah>,
  skenario: "1lokasi" | "4lokasi",
  masalah: Masalah[],
): BarisImpor[] {
  const sheet = SHEET_KOMPONEN;
  const lembar = cariLembar(wb, sheet);
  if (!lembar) {
    masalah.push({ sheet, baris: 0, pesan: `Sheet "${sheet}" tidak ada di berkas ini.` });
    return [];
  }
  const header = cariHeader(lembar, KOLOM_KOMPONEN, ["uraian", "harga satuan"], 30);
  if (!header) {
    masalah.push({
      sheet,
      baris: 0,
      pesan: `Baris header tidak ditemukan; sheet harus punya kolom "Uraian" dan "Harga satuan".`,
    });
    return [];
  }
  laporkanKolomHilang(header, KOLOM_KOMPONEN, sheet, masalah);

  const kVolume = header.kolom.get(skenario === "1lokasi" ? "volume1" : "volume4");
  const kTotal = header.kolom.get(skenario === "1lokasi" ? "total1" : "total4");
  const kUraian = header.kolom.get("uraian") as number;
  const kHarga = header.kolom.get("harga");

  // Kolom yang bergantung skenario tidak bisa ditandai `wajib` di daftar alias
  // (yang wajib hanya SALAH SATU pasangannya), jadi dilaporkan di sini.
  if (kVolume === undefined) {
    masalah.push({
      sheet,
      baris: header.baris,
      pesan: `Kolom volume untuk skenario ${skenario} ("Jumlah ${skenario === "1lokasi" ? "1" : "4"} lokasi") tidak ada; seluruh volume kosong.`,
    });
  }
  if (kTotal === undefined) {
    masalah.push({
      sheet,
      baris: header.baris,
      pesan: `Kolom total untuk skenario ${skenario} tidak ada; kecocokan volume x harga tidak bisa diperiksa.`,
    });
  }

  const hasil: BarisImpor[] = [];
  let volumeRumus = 0;
  let hargaRumus = 0;
  for (let baris = header.baris + 1; baris <= lembar.barisMaks; baris++) {
    // Tanpa uraian = baris kosong, pemisah, atau baris SUBTOTAL/TOTAL (yang
    // labelnya ada di kolom Tahap, bukan Uraian). Dilewati diam-diam.
    const uraian = bacaTeks(lembar.sel(baris, kUraian));
    if (uraian === null) continue;

    const teksTahap = bacaTeks(lembar.sel(baris, header.kolom.get("tahap") ?? 0));
    let tahap: string | null = null;
    if (teksTahap !== null) {
      tahap = petaTahap.get(normal(teksTahap)) ?? null;
      if (tahap === null) {
        masalah.push({ sheet, baris, pesan: `Tahap "${teksTahap}" tidak ada di daftar tahap; dikosongkan.` });
      }
    }

    const teksPenggerak = bacaTeks(lembar.sel(baris, header.kolom.get("penggerak") ?? 0));
    let penggerak: string | null = null;
    if (teksPenggerak !== null) {
      penggerak = petaPenggerak.get(normal(teksPenggerak)) ?? null;
      if (penggerak === null) {
        masalah.push({
          sheet,
          baris,
          pesan: `Penggerak "${teksPenggerak}" tidak ada di daftar penggerak; dikosongkan.`,
        });
      }
    }

    const volumeDariRumus = kVolume !== undefined && lembar.rumus(baris, kVolume);
    const hargaDariRumus = kHarga !== undefined && lembar.rumus(baris, kHarga);
    if (volumeDariRumus) volumeRumus++;
    if (hargaDariRumus) hargaRumus++;

    let volume: number | null = null;
    if (kVolume !== undefined) {
      const b = bacaAngka(lembar.sel(baris, kVolume));
      if (b.jenis === "angka") volume = b.nilai;
      else {
        masalah.push({ sheet, baris, pesan: pesanAngkaGagal(b, "Volume", uraian, volumeDariRumus) });
      }
    }

    let hargaSatuan: number | null = null;
    if (kHarga !== undefined) {
      const b = bacaAngka(lembar.sel(baris, kHarga));
      if (b.jenis === "angka") hargaSatuan = b.nilai;
      else {
        masalah.push({ sheet, baris, pesan: pesanAngkaGagal(b, "Harga satuan", uraian, hargaDariRumus) });
      }
    }

    let totalDiSheet: number | null = null;
    if (kTotal !== undefined) {
      const b = bacaAngka(lembar.sel(baris, kTotal));
      if (b.jenis === "angka") totalDiSheet = b.nilai;
      else if (b.jenis === "tolak") {
        masalah.push({ sheet, baris, pesan: `Total "${uraian}" tidak terbaca: ${b.alasan}.` });
      }
    }

    // Total TIDAK diimpor -- amount_idr GENERATED di database. Yang dilakukan
    // di sini hanya mencocokkan: selisih di atas 1 rupiah berarti sheet memakai
    // rumus lain, dan pengguna harus tahu SEBELUM angkanya masuk.
    if (totalDiSheet !== null && volume !== null && hargaSatuan !== null) {
      const seharusnya = volume * hargaSatuan;
      const selisih = totalDiSheet - seharusnya;
      if (Math.abs(selisih) > 1) {
        masalah.push({
          sheet,
          baris,
          pesan: `Total di sheet (${totalDiSheet}) tidak sama dengan volume x harga (${seharusnya}); selisih ${selisih}. Yang diimpor tetap volume dan harga, bukan total.`,
        });
      }
    }

    hasil.push({
      barisAsli: baris,
      uraian,
      tahap,
      penggerak,
      volume,
      satuanTeks: bacaTeks(lembar.sel(baris, header.kolom.get("satuan") ?? 0)),
      hargaSatuan,
      sumberRef: bacaTeks(lembar.sel(baris, header.kolom.get("sumber") ?? 0)),
      totalDiSheet,
      volumeDariRumus,
      hargaDariRumus,
    });
  }

  laporkanNilaiRumus(sheet, hasil.length, masalah, [
    { apa: "volume", jumlah: volumeRumus },
    { apa: "harga satuan", jumlah: hargaRumus },
  ]);
  return hasil;
}

function petakanAsumsi(wb: Map<string, LembarMentah>, masalah: Masalah[]): AsumsiImpor[] {
  const sheet = SHEET_ASUMSI;
  const lembar = cariLembar(wb, sheet);
  if (!lembar) {
    masalah.push({ sheet, baris: 0, pesan: `Sheet "${sheet}" tidak ada di berkas ini.` });
    return [];
  }
  const header = cariHeader(lembar, KOLOM_ASUMSI, ["variabel", "nilai"], 30);
  if (!header) {
    masalah.push({
      sheet,
      baris: 0,
      pesan: `Baris header tidak ditemukan; sheet harus punya kolom "Variabel" dan "Nilai".`,
    });
    return [];
  }
  laporkanKolomHilang(header, KOLOM_ASUMSI, sheet, masalah);

  const kVariabel = header.kolom.get("variabel") as number;
  const kNilai = header.kolom.get("nilai");

  const hasil: AsumsiImpor[] = [];
  let nilaiRumus = 0;
  for (let baris = header.baris + 1; baris <= lembar.barisMaks; baris++) {
    const selVariabel = lembar.sel(baris, kVariabel);
    // Judul seksi ("A. Proyek, finansial, dan skenario") hanya mengisi kolom
    // pertama; baris seperti itu, dan baris kosong, dilewati diam-diam.
    if (selVariabel === null) continue;
    if (barisUlanganHeader(lembar, baris, KOLOM_ASUMSI, lembar.kolomMaks)) continue;

    if (typeof selVariabel !== "string") {
      // Seksi G/H template R2 adalah tabel matriks (T1..T6 per kolom), bukan
      // daftar Kelompok/Variabel/Nilai. Barisnya dilaporkan, TIDAK diimpor
      // sebagai asumsi bernama "1" bernilai 0,9 -- dan tidak pula dibuang
      // tanpa jejak.
      masalah.push({
        sheet,
        baris,
        pesan: `Kolom Variabel berisi ${typeof selVariabel === "number" ? "angka" : "nilai"} "${String(selVariabel)}", bukan nama variabel; baris tidak diimpor.`,
      });
      continue;
    }
    const variabel = bacaTeks(selVariabel);
    if (variabel === null) continue;

    let nilai: number | null = null;
    if (kNilai !== undefined) {
      const b = bacaAngka(lembar.sel(baris, kNilai));
      if (b.jenis === "angka") nilai = b.nilai;
      else {
        masalah.push({
          sheet,
          baris,
          pesan:
            b.jenis === "kosong"
              ? `Asumsi "${variabel}" tidak punya nilai.`
              : `Nilai asumsi "${variabel}" tidak terbaca: ${b.alasan}.`,
        });
      }
    }

    const teksKeyakinan = bacaTeks(lembar.sel(baris, header.kolom.get("keyakinan") ?? 0));
    let keyakinan: "high" | "medium" | "low" | null = null;
    if (teksKeyakinan !== null) {
      keyakinan = PETA_KEYAKINAN[normal(teksKeyakinan)] ?? null;
      if (keyakinan === null) {
        masalah.push({
          sheet,
          baris,
          pesan: `Tingkat keyakinan "${teksKeyakinan}" tidak dikenali (High/Medium/Low atau Tinggi/Sedang/Rendah); dikosongkan.`,
        });
      }
    }

    hasil.push({
      barisAsli: baris,
      kelompok: bacaTeks(lembar.sel(baris, header.kolom.get("kelompok") ?? 0)),
      variabel,
      nilai,
      satuan: bacaTeks(lembar.sel(baris, header.kolom.get("satuan") ?? 0)),
      idSumber: bacaTeks(lembar.sel(baris, header.kolom.get("idSumber") ?? 0)),
      keyakinan,
      catatan: bacaTeks(lembar.sel(baris, header.kolom.get("catatan") ?? 0)),
    });
    if (kNilai !== undefined && lembar.rumus(baris, kNilai)) nilaiRumus++;
  }

  laporkanNilaiRumus(sheet, hasil.length, masalah, [{ apa: "nilai", jumlah: nilaiRumus }]);
  return hasil;
}

/**
 * Membaca satu berkas RAB (.xlsx) menjadi daftar asumsi dan komponen biaya.
 *
 * `opts.skenario` menentukan kolom volume DAN kolom total mana yang dipakai:
 * "1lokasi" memakai pasangan "Jumlah 1 lokasi"/"Total 1 lokasi", "4lokasi"
 * memakai "Jumlah 4 lokasi"/"Total 4 lokasi".
 *
 * Melempar Error hanya bila berkasnya sendiri tidak bisa dibuka (bukan .xlsx,
 * rusak, terkunci, Zip64). Kegagalan pada tingkat sheet/baris tidak melempar:
 * ia menjadi `Masalah`, supaya satu sheet yang bermasalah tidak ikut membatalkan
 * sheet yang lain.
 */
export function bacaWorkbookRab(
  buf: Buffer | ArrayBuffer,
  opts: { skenario: "1lokasi" | "4lokasi" },
): HasilImpor {
  const wb = bukaWorkbookMentah(buf);
  const masalah: Masalah[] = [];
  const asumsi = petakanAsumsi(wb, masalah);
  const komponen = petakanKomponen(wb, opts.skenario, masalah);
  // TIDAK memblokir impor, hanya melaporkan: workbook yang pemeriksaannya
  // sendiri gagal tetap boleh diimpor, asal pengguna melihatnya lebih dulu.
  const statusModel = bacaStatusModel(wb);
  const jadwalTahap = bacaJadwalTahap(wb);
  return { asumsi, komponen, masalah, statusModel, jadwalTahap };
}
