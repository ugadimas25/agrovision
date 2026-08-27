-- 0061_budget_plan_from_excel.sql
-- Mematangkan RAB (0060) memakai model nyata: docs/RAB_Agroforestry_100ha_Banyumas(1).xlsx
--
-- Excel itu 19 sheet dan bukan sekadar daftar biaya -- ia model keputusan
-- dengan disiplin yang justru sudah sejalan dengan doktrin repo ini:
--
--   * 02_Assumptions memberi tiap asumsi ID SUMBER dan TINGKAT KEYAKINAN.
--     Dari 100+ asumsi, 51 bertanda Low. Itu bukan kelemahan model, itu
--     kejujuran yang dipertahankan -- dan RAB kami menghilangkannya.
--   * Harga akuisisi lahan sengaja Rp0 dengan sumber "OPEN" dan catatan
--     "wajib diisi setelah due diligence". Persis aturan null-bukan-nol.
--   * 15_Checks membandingkan Aktual vs Harapan vs Toleransi -- padanan
--     app.check_*() di sini.
--
-- Migrasi ini mengambil lima hal yang PALING jelas terbaca dari berkas itu,
-- semuanya aditif (kolom baru berdefault), tanpa menyentuh policy 0060.
-- Yang lebih besar -- pusat asumsi, penggerak volume, skenario 1 vs 4 lokasi,
-- OPEX 10 tahun, registri sumber -- sengaja TIDAK dikerjakan di sini; masing-
-- masing menuntut keputusan produk dan ditulis sebagai tahap tersendiri di
-- docs/19-rab-dari-excel-banyumas.md.

-- ===========================================================================
-- §1. CAPEX vs OPEX
--
-- Excel memisahkannya jadi dua sheet: 08_CAPEX_RAB (investasi Tahun 0) dan
-- 09_OPEX_10Y (biaya operasional T1..T10). Mencampurnya membuat "total RAB"
-- menjumlahkan investasi sekali-seumur-proyek dengan biaya berulang -- angka
-- yang tidak berarti apa-apa bagi finance maupun agronomis.
-- ===========================================================================

CREATE TYPE app.budget_cost_kind AS ENUM ('capex', 'opex');

COMMENT ON TYPE app.budget_cost_kind IS
  'capex = investasi awal (08_CAPEX_RAB), opex = biaya operasional berulang '
  '(09_OPEX_10Y). Dipisah karena keduanya tidak boleh dijumlahkan begitu saja.';

ALTER TABLE app.budget_plan_items
  ADD COLUMN cost_kind app.budget_cost_kind NOT NULL DEFAULT 'capex';

-- ===========================================================================
-- §2. Tahap pekerjaan
--
-- Excel mengelompokkan 19 tahap berhuruf: A Land / A Assessment / A Survey /
-- A Safeguard / A Design, B Land prep / B Soil, C Road / C Drain / C Boundary /
-- C Facility / C Water / C Power / C Mobilization, D Planting / D Ecology,
-- E Equipment, F Systems / F Payroll.
--
-- Ini BUKAN bulan. 0060 hanya punya phase_month (bulan relatif), dan itu
-- menjawab "kapan uangnya keluar" tapi tidak "pekerjaan apa ini". Rapat Fadli
-- memakai bulan; Excel memakai tahap; keduanya diperlukan dan tidak saling
-- menggantikan -- survei topografi di bulan 1 dan pembuatan jalan di bulan 1
-- adalah dua urusan berbeda dengan penanggung jawab berbeda.
--
-- Teks bebas, BUKAN enum: daftar tahap milik metodologi proyek, bukan milik
-- aplikasi. Mengunci 19 nilai hari ini berarti migrasi baru setiap kali
-- agronomis menambah satu tahap.
-- ===========================================================================

ALTER TABLE app.budget_plan_items ADD COLUMN stage text;

COMMENT ON COLUMN app.budget_plan_items.stage IS
  'Tahap pekerjaan mengikuti 08_CAPEX_RAB (mis. "B Land prep", "C Road"). '
  'Sengaja teks bebas: daftar tahap milik metodologi proyek, bukan aplikasi.';

CREATE INDEX budget_plan_items_stage_idx ON app.budget_plan_items (plan_id, stage);

-- ===========================================================================
-- §3. Penggerak volume
--
-- Di Excel, volume TIDAK diketik: ia diturunkan dari penggerak (gross ha,
-- net ha, site, lot, ton, m, unit, sample, pit, % stock, tree kg, annual)
-- dikali asumsi. Perhitungannya belum dipindahkan ke sini -- itu tahap 2 --
-- tapi penggerak tiap baris dicatat sekarang, supaya ketika pusat asumsi
-- datang, baris lama tidak perlu ditebak ulang asal angkanya.
-- ===========================================================================

ALTER TABLE app.budget_plan_items ADD COLUMN driver text;

COMMENT ON COLUMN app.budget_plan_items.driver IS
  'Penggerak volume mengikuti kolom "Penggerak" 08_CAPEX_RAB (gross ha, net ha, '
  'site, lot, ton, m, unit, sample, % stock, annual, calculated). Untuk sekarang '
  'hanya dicatat; perhitungan otomatis menunggu pusat asumsi (tahap 2).';

-- ===========================================================================
-- §4. Sumber & tingkat keyakinan
--
-- Kolom "Dasar/sumber/pengecualian" di 08 dan pasangan "ID sumber" +
-- "Tingkat keyakinan" di 02 adalah bagian paling berharga dari berkas itu.
-- 16_Sources bahkan menyimpan judul, URL, tanggal terbit, dan tanggal akses.
--
-- Angka anggaran tanpa asalnya adalah angka fabrikasi yang kebetulan rapi --
-- persis yang app.emission_factors cegah dengan source_citation, dan yang
-- app.check_production_readiness() laporkan bila kosong.
-- ===========================================================================

CREATE TYPE app.assumption_confidence AS ENUM ('high', 'medium', 'low');

COMMENT ON TYPE app.assumption_confidence IS
  'Tingkat keyakinan angka, mengikuti 02_Assumptions. Di model Banyumas, 51 dari '
  '100+ asumsi bertanda Low -- itu informasi, bukan aib, dan harus ikut terbaca.';

ALTER TABLE app.budget_plan_items ADD COLUMN source_ref text;
ALTER TABLE app.budget_plan_items ADD COLUMN confidence app.assumption_confidence;

COMMENT ON COLUMN app.budget_plan_items.source_ref IS
  'Dari mana angka ini berasal: kode sumber (USR/ASM/DES/S07/...), nama vendor, '
  'atau kalimat dasar perhitungan. NULL = belum disebutkan, dan itu ditampilkan '
  'apa adanya di layar -- bukan disembunyikan.';

COMMENT ON COLUMN app.budget_plan_items.confidence IS
  'NULL = belum dinilai. Sengaja tanpa default: menebak "medium" untuk baris '
  'yang belum ditelaah akan membuat seluruh kolom ini tidak berarti.';

-- ===========================================================================
-- §5. Kontingensi tidak berlaku untuk semua baris
--
-- 02_Assumptions C14: "Cadangan CAPEX 10% -- TIDAK diterapkan pada akuisisi
-- lahan", dan 08 menghitungnya sebagai (SUBTOTAL - baris akuisisi) x %.
-- Alasannya masuk akal: harga tanah hasil negosiasi tidak membengkak seperti
-- volume pekerjaan. 0060 mengalikan kontingensi ke SELURUH subtotal, yang
-- melebih-lebihkan anggaran tepat pada komponen termahal.
-- ===========================================================================

ALTER TABLE app.budget_plan_items
  ADD COLUMN exclude_from_contingency boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN app.budget_plan_items.exclude_from_contingency IS
  'true = tidak ikut dasar perhitungan kontingensi. Dipakai untuk akuisisi/sewa '
  'lahan, mengikuti 02_Assumptions C14 pada model Banyumas.';

-- ===========================================================================
-- §6. Baris dinonaktifkan, BUKAN dihapus
--
-- 17_Model_Fleksibel memakai kolom `Aktif` di seluruh bagiannya, dan peta
-- ketergantungan (bagian H) menuliskan aturannya dua kali: "Aktif=0
-- mengeluarkan baris dari total TANPA MENGHAPUS REFERENSI" dan "Jangan hapus
-- baris total".
--
-- Alasannya bukan kerapian. RAB adalah dokumen yang dinegosiasikan: baris yang
-- dicoret finance minggu ini bisa dihidupkan lagi bulan depan, dan pertanyaan
-- "kenapa pos ini hilang?" harus bisa dijawab. 0060 hanya punya DELETE, yang
-- membuang pertanyaan itu bersama barisnya -- dan menyisakan jejaknya cuma di
-- audit_log, tempat yang tidak dibuka siapa pun saat rapat anggaran.
-- ===========================================================================

ALTER TABLE app.budget_plan_items
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN app.budget_plan_items.is_active IS
  'false = dikeluarkan dari seluruh total, tetapi tetap terlihat di layar dengan '
  'penanda. Mengikuti kolom Aktif di 17_Model_Fleksibel: baris RAB dinonaktifkan, '
  'tidak dihapus, supaya alasan pencoretan tetap bisa ditelusuri.';

CREATE INDEX budget_plan_items_active_idx ON app.budget_plan_items (plan_id) WHERE is_active;

-- ===========================================================================
-- §7. Kesehatan tetap terjaga
-- ===========================================================================
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_rls_coverage() % baris setelah 0061', n; END IF;
  SELECT count(*) INTO n FROM app.check_audit_coverage();
  IF n > 0 THEN RAISE EXCEPTION 'check_audit_coverage() % baris setelah 0061', n; END IF;
END $$;
