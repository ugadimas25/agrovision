# Ringkasan Meeting — Call with Muhammad Fadli

**Tanggal:** 26 Agustus 2026, 13:55
**Durasi:** 1 jam 25 menit
**Peserta:** Muhammad Fadli, Dimas Perceka
**Topik:** Perbaikan flow & struktur modul AgroVision (Rencana Anggaran / RAB Kebun)

> **Catatan kualitas sumber:** transkrip ini hasil auto-transcription dan banyak kata salah tangkap ("pasien" = "fase ini", "dolomit" jadi "idolobid/dalamit", "agronomis" jadi "adronomis/astronomis"). Beberapa angka juga tidak terbaca jelas dan tidak konsisten. Konfirmasi ulang ke Fadli sebelum angka di dokumen ini dipakai sebagai basis keputusan.

---

## 1. Topik utama: gap di flow AgroVision

Fadli mengangkat satu masalah mendasar: **aplikasi saat ini langsung meminta input anggaran, padahal ada satu langkah yang hilang sebelumnya.** Yang tahu kebutuhan operasional kebun bukan orang finance, tapi agronomis.

Argumen Fadli: orang finance tidak tahu apakah perlu aplikasi kapur dolomit dulu, atau perlu pupuk kandang di tiap lubang tanam. Finance hanya punya uang dan wewenang menyetujui.

**Kesimpulan:** perlu modul baru — awalnya diusulkan nama *Farm Planning*, akhirnya disepakati **"Rencana Anggaran" (RAB Kebun)**. UI dibayangkan seperti Excel: agronomis mengisi komponen satu per satu.

---

## 2. Flow baru yang disepakati

| Tahap | Pelaku | Output |
|---|---|---|
| 1. Susun RAB set-up kebun (komponen, volume, harga, durasi fase) | Agronomis | Draft RAB, submit |
| 2. Review & approval — bisa dikoreksi (mis. ajuan 5 M tapi budget hanya 4 M) | Finance | Master anggaran |
| 3. Master anggaran feeding ke **price list** | Sistem | Harga acuan terkunci |
| 4. Eksekusi harian (persiapan lahan → pembibitan → tanam → pemeliharaan) | Agent lapangan | Realisasi |
| 5. Saldo anggaran berkurang tiap realisasi | Sistem | Dashboard anggaran / serapan / sisa |

Konsekuensi yang disadari Dimas di tengah diskusi: **sekarang ada 2 approval** — approval rencana anggaran (finance) dan approval realisasi.

Catatan tambahan: setelah master anggaran disetujui, finance **masih bisa menambah baris** (mis. hire ahli hidrologi, konsultan). Yang input satu-per-satu di awal tetap agronomis.

---

## 3. Contoh perhitungan yang dibahas

Asumsi: **100 ha, kelapa + durian intercrop.**

### Pengadaan bibit
- 140 bibit/ha × 100 ha = 14.000 bibit
- Kelapa saja: 14.000 × Rp100.000 = **Rp1,4 M**
- Kalau intercrop: 7.000 kelapa (Rp700 jt) + 7.000 durian @Rp200.000 (Rp1,4 M) = **Rp2,1 M**, belum termasuk transport & pemeliharaan bibit

### Land clearing (manual)
- Upah Rp150.000/orang/hari, 7 jam kerja, 1 orang ≈ 2,5 ha/hari
- 10 orang × 5 hari = **Rp7,5 juta**
- Kalau mekanis: komponennya jadi solar (±2 liter/mesin/hari) + biaya mesin

### Persiapan lahan lainnya
Aplikasi dolomit (±100 kg/ha untuk netralkan pH, tunggu 2 minggu) → pembuatan lubang tanam (2 minggu) → aplikasi kompos/pupuk kandang per lubang → penggemburan/bedengan → layout kebun.

### Pembibitan
±1 bulan. Bibit dari Jawa Tengah/Jogja/Sumatera perlu aklimatisasi & karantina. Sistem harus mencatat **kematian bibit harian** — itu uang yang hilang.

### Tanam
November (jelang musim hujan). 5 ha/hari → ±20 hari untuk 100 ha. Biaya: tenaga kerja + transport bibit dari lokasi pembibitan ke lahan.

### Pemeliharaan
Upah tenaga kerja (Rp120–150 rb/hari, ±22 hari kerja/bulan), penyiangan/gulma, pemupukan NPK ±200 g/tanaman tiap 6 bulan, ±4 jenis pupuk dengan jadwal berbeda, penyemprotan pestisida, pemangkasan setelah tahun ke-1.

### Irigasi
Belum diputuskan — sumur bor, sedot dari sungai, irigasi tetes, atau drone. **Harus dikonfirmasi ke agronomis.**

### Alat
Cangkul ±200 unit untuk 100 ha (1 cangkul = 0,5 ha). Dibedakan antara habis-pakai (pupuk) vs aset (cangkul).

### Buffer
Kontingensi **5%**.

---

## 4. Simulasi drawdown anggaran

Total disetujui: **Rp10 M untuk 100 ha** (Rp100 juta/ha)

| Bulan | Kegiatan | Biaya | Sisa |
|---|---|---|---|
| 1 | Persiapan lahan | 200 jt | 9,8 M |
| 2 | Pembibitan | 5 M | 4,8 M |
| 3 | Tanam | 300 jt | 4,5 M |
| 4+ | Pemeliharaan | ±300–500 jt/bln | menurun |

**Horizon waktu:** Tahun 1 = Rp10 M. Tahun 2 turun drastis (mis. Rp500 jt/tahun). Tahun 3 mulai ada revenue (kelapa genjah berbuah ±3 tahun, durian ±5 tahun). Karena itu agronomis mungkin menyarankan tanaman sela — pisang atau jagung — supaya panen sudah mulai di tahun ke-2.

**Konsep serapan:** kalau anggaran 1 M terpakai 900 jt → serapan 90%. Fadli menekankan **serapan rendah ≠ bagus** — bisa jadi karena belum ketemu pekerja, atau baru 20 dari 100 ha yang tergarap. Serapan >100% juga mungkin (upah naik ke Rp160 rb, musim kemarau bikin sumur lebih mahal). Angka ini jadi bahan diskusi agronomis ↔ finance.

---

## 5. Keputusan perubahan menu & struktur aplikasi

- ✅ Tambah modul **Rencana Anggaran** (di bawah Akuntansi)
- ✅ Rename **"Pratanam" → "Persiapan"** dan **"Aktivitas Kebun" → "Pemeliharaan"** (naming lebih jelas)
- ✅ Tambah sub-menu **Penanaman / Planting** di bawah Persiapan — saat ini hanya ada Persiapan Lahan & Pembibitan, aktivitas tanam belum ter-record padahal ada biayanya
- ✅ **Master Data dihapus**, diganti jadi **Konfigurasi** (mis. luas lahan yang siap sekarang)
- ✅ **Agri Input** dan **Equipment** tidak berdiri sendiri lagi → dipindah ke **Pengaturan** sebagai katalog (jenis pupuk, size, dll.)
- ⬜ Kandidat menu baru: **IPM (Integrated Pest Management)** — belum final, Dimas menyebut penyemprotan sudah ada
- ⚠️ Kategori biaya harus konsisten antar modul — Dimas menemukan kategori (mis. "Logistik") ada di satu tempat tapi tidak terefleksi di tempat lain
- ⚠️ Perlu parameter waktu (alokasi anggaran per tahun/fase)

**Masalah terbuka:** Dimas belum punya solusi cara menghitung serapan **secara agregat**, karena tiap komponen punya satuan berbeda (hektar, orang-hari, kg, unit) dan tidak bisa dijumlahkan. Per-komponen sudah kebayang; keseluruhan kemungkinan hanya total rupiah (dianggarkan vs terpakai).

---

## 6. Action items

| # | Siapa | Aksi | Target |
|---|---|---|---|
| 1 | Fadli | Cari file Excel RAB kebun kelapa lama, atau buat ulang formulir komponen perencanaan kebun, lalu share | "sebentar lagi" |
| 2 | Dimas | Bikin modul Rencana Anggaran + skenario input & submit agronomis + flow approval finance, sambil menunggu Excel dari Fadli | Mulai sekarang |
| 3 | Fadli | Konfirmasi ke agronomis: metode irigasi, dosis pupuk, asumsi lahan | Belum dijadwalkan |
| 4 | Fadli | Kirim undangan kalender meeting Big Tree Farms | 8 Sep, 08:00 |
| 5 | Dimas | Siapkan portofolio untuk meeting Big Tree Farms | Sebelum 8 Sep |

**Asumsi kerja yang dipakai:** 100 ha, satu lokasi, kelapa + durian. Fadli menolak asumsi 100.000 ha — pembanding: kebun kelapa terbesar di dunia (perusahaan santan Kara di Riau) hanya ±23.000 ha. Kalau ternyata lahan tersebar (mis. Semarang + Kalimantan), price list-nya berbeda lagi.

**Risiko yang perlu dicatat:** seluruh struktur RAB ini disusun dari asumsi Fadli, bukan validasi pengguna sebenarnya. Agronomis belum pernah aktif ikut meeting — Dimas menyebut agronomis pernah ikut tapi belum membuka aplikasi, jadi posisinya "ngikutin aja". Fadli sadar akan hal ini ("kita usulkan dulu, kalau agronomis punya pemikiran lain nanti kita sesuaikan"), tapi konsekuensinya nyata: modul yang dibangun Dimas berpotensi harus dirombak setelah agronomis benar-benar review.
