# 19 · Belajar dari RAB Agroforestry 100 ha Banyumas

| | |
|---|---|
| **Sumber** | `docs/RAB_Agroforestry_100ha_Banyumas(1).xlsx` — 19 sheet, model keputusan finansial 10 tahun |
| **Ditulis** | 27 Agustus 2026, setelah modul Rencana Anggaran (#51/#52) jalan |
| **Untuk** | Menutup jarak antara RAB versi aplikasi dan RAB versi sungguhan |

## Yang ternyata sudah sejalan

Berkas itu bukan daftar belanja. Ia model dengan disiplin yang **sudah dipegang repo ini**, hanya di tempat berbeda:

| Di Excel | Padanannya di sini |
|---|---|
| `02_Assumptions`: tiap asumsi punya **ID sumber** + **tingkat keyakinan** | `emission_factors.source_citation`, `allometric_coefficients.requires_validation` |
| Harga akuisisi lahan **Rp0 dengan sumber "OPEN"** dan catatan "wajib diisi setelah due diligence" | Aturan `null` = belum ada data, dirender `—`, bukan `0` |
| `15_Checks`: Aktual vs Harapan vs Selisih vs **Toleransi** vs Status | `app.check_rls_coverage()`, `check_audit_coverage()`, `check_production_readiness()` |
| `17_Model_Fleksibel`: kolom **`Aktif`** di tiap bagian, "Aktif=0 mengeluarkan baris dari total tanpa menghapus referensi" | Append-only + `is_active` di `users`, `master_items`, `price_list` |

Angka paling jujur di seluruh berkas: **51 dari 100+ asumsi bertanda `Low`**. Model ini tidak berpura-pura pasti — dan RAB versi aplikasi tidak boleh terlihat lebih pasti daripada sumbernya.

## Yang sudah diambil (migrasi 0061)

| Konsep | Kolom |
|---|---|
| CAPEX (08) vs OPEX (09) dipisah | `cost_kind` |
| 19 tahap pekerjaan (A Land … F Payroll) | `stage`, teks bebas + `<datalist>` |
| Penggerak volume (gross ha, net ha, site, lot, ton, m, …) | `driver` (dicatat, belum menghitung) |
| Dasar/sumber angka + tingkat keyakinan | `source_ref`, `confidence` (nullable — kosong = belum dinilai) |
| Kontingensi **tidak** berlaku untuk akuisisi lahan (`02!C14`) | `exclude_from_contingency` |
| Baris dicoret, bukan dihapus | `is_active` + `toggleItemAction` menggantikan hapus |

## Yang belum — dan kenapa

### Tahap 2 · Pusat asumsi + penggerak yang benar-benar menghitung

Di Excel, volume **tidak diketik**: `Jumlah = Basis × Rasio per basis`, dan basisnya menunjuk `02_Assumptions` (luas bruto 100 ha → areal efektif 88 ha → populasi per kerapatan). Satu perubahan luas menggerakkan CAPEX, OPEX, produksi, dan arus kas sekaligus.

Di aplikasi, volume masih angka mati. Artinya mengubah asumsi luas berarti mengedit 11 baris satu per satu — dan tidak ada yang menjamin semuanya ikut berubah.

**Butuh:** tabel `budget_assumptions` (variabel, nilai, satuan, sumber, keyakinan) + `budget_plan_items.basis_ratio`, lalu `volume` jadi kolom turunan. **Ditahan karena:** ini mengubah arti kolom `volume` yang sudah dipakai, dan bentuk asumsinya sebaiknya dikonfirmasi ke agronomis dulu.

### Tahap 3 · Skenario (1 lokasi vs 4 lokasi)

`08_CAPEX_RAB` punya kolom **Jumlah/Total untuk 1 lokasi dan 4 lokasi**, plus kolom **Terpilih** yang memilih salah satu lewat `02!C8`. Selisihnya besar: Rp 14,5 M vs Rp 23,1 M — dan seluruh perbedaan itu **biaya fragmentasi**, bukan agronomi (`12_Scenario_1v4` sengaja menyamakan produksinya).

Rapat Fadli 26 Agu menyebut kemungkinan lahan tersebar (Semarang + Kalimantan). Jadi ini bukan fitur hipotetis.

**Butuh:** dimensi skenario pada baris RAB, atau RAB kembar yang bisa dibandingkan berdampingan.

### Tahap 4 · Horizon 10 tahun, dengan tahun mulai–akhir

`09_OPEX_10Y` dan bagian F/G di `17_Model_Fleksibel` memakai kolom **T1…T10** dan pasangan **Tahun mulai / Tahun akhir** per baris. Aplikasi hanya punya `phase_month` — satu titik, bukan rentang, dan horizonnya bulan.

Konsekuensinya: biaya berulang harus ditulis ulang tiap periode, dan tidak ada tempat menaruh "pemeliharaan T1–T10 dengan inflasi 4%/tahun".

### Tahap 5 · Registri sumber

`16_Sources` menyimpan **ID, topik, judul, URL, tanggal terbit, tanggal akses, tingkat keyakinan** — 20+ sumber nyata (Kementan, SK Gubernur untuk UMK, tarif lab BRMP, LSO). `source_ref` yang baru hanya teks bebas; ia menampung kalimat, bukan tautan yang bisa diperiksa ulang.

**Butuh:** tabel `budget_sources` + relasi, sejajar `emission_factors.source_citation`.

### Tahap 6 · Dashboard, arus kas, sensitivitas

`01_Dashboard`, `11_Cash_Flow`, `13_Sensitivity` menghitung NPV, IRR, pendanaan puncak, tahun pengembalian. **Sengaja paling belakang** — keputusan #8 melarang menghidupkan proyeksi pendapatan yang dulu dihapus karena fabrikatif. Angka-angka itu baru boleh muncul kalau asumsinya bersumber, dan sumbernya baru ada setelah tahap 2 dan 5.

## Peringatan yang harus ikut terbawa

Berkas ini **model, bukan kebenaran**. `15_Checks` bagian "peringatan yang tidak menggagalkan rumus" menuliskannya sendiri: harga akuisisi lahan masih Rp0 sampai ada calon nyata; tanah/air/lereng dapat mengubah kebutuhan; harga berkeyakinan rendah adalah asumsi anggaran dan perlu minimal beberapa penawaran.

Jangan memindahkan angkanya ke aplikasi sebagai data. Yang dipindahkan adalah **strukturnya** — dan struktur itu justru menyediakan tempat untuk mengatakan seberapa lemah tiap angka.
