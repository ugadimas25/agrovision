# Skenario uji — modul Rencana Anggaran (RAB)

Disusun 1 September 2026, mencakup pekerjaan migrasi **0060–0066**: impor Excel,
tabel sunting langsung, pusat asumsi, penugasan lapangan, dan kurva S serapan.

**Akun uji (login stub, cukup email tanpa kata sandi):**

| Peran | Email | Dipakai untuk |
|---|---|---|
| Agronomis | `agronomis@demo.invalid` | menyusun RAB, impor, menugaskan |
| Approver (finance) | `approver@demo.invalid` | menyetujui, tanggal mulai |
| Creator (lapangan) | `creator@demo.invalid` | merealisasikan penugasan |
| Viewer | `direktur@demo.invalid` | uji hanya-baca |
| Super admin | `admin@demo.invalid` | master data |

**Berkas uji:** `docs/Template_Impor_RAB.xlsx` (4 sheet, 28 KB) atau
`docs/RAB_Agroforestry_100ha_Banyumas_R2.xlsx` (26 sheet, 224 KB). Keduanya
dibaca identik; yang besar tambahannya hanya memuat rumus, sehingga peringatan
"angka turunan" muncul untuknya.

**Cara menandai:** PASS / FAIL / BLOCKED. Pakai **BLOCKED** hanya bila pengujian
tidak bisa dijalankan karena hal di luar fitur (data belum ada, layanan mati) —
fitur yang ada tapi salah adalah **FAIL**.

---

## A · Impor Excel

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-01** | Agronomis | Buat RAB baru (draft). Buka panel **Impor dari Excel**, unggah template, skenario **1 lokasi**, tekan *Baca berkas*. | Muncul ringkasan **36 komponen dan 130 asumsi**. Tidak ada yang tersimpan sebelum tombol Simpan ditekan. | Critical |
| **R-02** | Agronomis | Ulangi R-01 dengan skenario **4 lokasi**. | Jumlah komponen tetap 36, tapi volume beberapa baris berbeda (kolom "Jumlah 4 lokasi" yang dipakai). | High |
| **R-03** | Agronomis | Pada pratinjau, perhatikan blok **Pemeriksaan internal workbook (15_Checks)**. | Menampilkan status **PASS** beserta kalimat bahwa itu hanya berarti rumusnya konsisten, bukan angkanya tervalidasi lapangan. | High |
| **R-04** | Agronomis | Unggah `RAB_Agroforestry_100ha_Banyumas_R2.xlsx` (yang besar). Perhatikan blok biru. | Menyebut **36 dari 36 volume dan 18 dari 36 harga satuan berasal dari rumus**, dan bahwa nilainya jadi angka tetap. | Critical |
| **R-05** | Agronomis | Unggah `Template_Impor_RAB.xlsx` (yang ramping). | Blok biru **tidak muncul** — berkas itu memang tidak memuat rumus. Bukan bug. | Medium |
| **R-06** | Agronomis | Perhatikan kotak **Bulan** di sebelah tiap tahap, tanpa menekan tombol apa pun. | Sudah terisi dari jadwal: A Survey **2**, B Land prep **3**, B Soil **6**, D Planting **6**, D Ecology **8**. Keterangan menyebut *"8 dari 19 tahap"*. | Critical |
| **R-07** | Agronomis | Ubah salah satu bulan secara manual, lalu tekan **Kembalikan ke jadwal berkas**. | Angka kembali ke nilai dari sheet 05. | Medium |
| **R-08** | Agronomis | Tekan **Cocokkan otomatis dari nama tahap**. | 7 tahap terisi (A Survey → Jasa Survei, B Land prep → Persiapan Lahan, B Soil → Pupuk, D Planting → Bibit, E Equipment → Alat, C Mobilization → Logistik, F Payroll → Tenaga Kerja). 12 sisanya tetap "lewati". | High |
| **R-09** | Agronomis | Tanpa memetakan kategori satu pun, coba tekan **Simpan ke RAB ini**. | Tombol **nonaktif**, dengan alasan tertulis. Tidak ada yang tersimpan. | Critical |
| **R-10** | Agronomis | Pilih satu kategori pada **terapkan ke semua tahap**. | Ke-19 dropdown terisi sekaligus; hitungan di atas tombol berubah jadi **36 dari 36 komponen akan masuk**. | High |
| **R-11** | Agronomis | Perhatikan kotak peringatan kuning. | Menyebut **7 baris pos borongan** (satuan Rp, harga Rp 1) yang akan diimpor sebagai volume 1 × harga penuh, dan satuan yang tidak ada di master. | High |
| **R-12** | Agronomis | Perhatikan kotak hijau **Tautkan N baris ke asumsinya**. | Tercentang, menyebut **15 baris**, dan mencantumkan rasionya (mis. `net_ha (88) × 70`). | Critical |
| **R-13** | Agronomis | Tekan **Simpan ke RAB ini**. | Pesan menyebut jumlah komponen, asumsi, **sebaran bulan sebenarnya** ("Tersebar ke bulan 1, 2, 3, 6, 8"), dan berapa baris ditautkan. Bukan kalimat tetap "semua bulan ke-1". | Critical |

## B · Angka hasil impor

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-14** | Agronomis | Cari baris **Tools, machines, vehicles, PPE** di tabel komponen. | Volume **1**, harga satuan **Rp 2.287.100.000**, jumlah Rp 2.287.100.000. BUKAN volume 2,28 miliar × Rp 1. | Critical |
| **R-15** | Agronomis | Bandingkan kartu **Total RAB** dengan `SUBTOTAL SEBELUM CADANGAN` di sheet 08 (Rp 13.880.136.800 untuk 1 lokasi), dengan seluruh tahap dipetakan. | Cocok, sebelum kontingensi ditambahkan. Selisih hanya boleh berasal dari baris yang sengaja dilewati. | Critical |
| **R-16** | Agronomis | Buka **Sebaran per bulan**. | Lebih dari satu baris bulan. Kalau hanya "bulan ke-1", berarti R-06 gagal. | Critical |
| **R-17** | Agronomis | Cari baris **Cover crop/insectary establishment**. | **Tidak ada** — volumenya 0 di berkas, dan pesan impor menyebutnya dilewati beserta alasannya. | Medium |

## C · Asumsi & penautan

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-18** | Agronomis | Buka tabel **Asumsi**, lihat baris `proporsi_areal_efektif` dan `inflasi_biaya`. | Nilainya **0,88** dan **0,04**. Kalau tampil `1` dan `0`, itu bug pembulatan — FAIL. | Critical |
| **R-19** | Agronomis | Lihat kolom **Dipakai**. | `luas_bruto`, `areal_agroforestri_efektif`, dan `jumlah_lokasi_terpilih` menunjukkan angka **lebih dari 0 baris**. | Critical |
| **R-20** | Agronomis | Ubah `luas_bruto` dari 100 jadi 120, tekan **Simpan asumsi**. | Volume baris berpenggerak `gross ha` ikut berubah (100 → 120), dan Total RAB bergeser. Pesan menyebut berapa asumsi disimpan. | Critical |
| **R-21** | Agronomis | Kembalikan `luas_bruto` ke 100. | Volume kembali ke angka semula, persis. | High |
| **R-22** | Agronomis | Perhatikan baris yang tertaut di tabel komponen. | Sel Volume-nya **tidak bisa diketik**, dan di bawahnya tertulis rumusnya (`= luas_bruto × 1`). | High |

## D · Tabel sunting langsung

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-23** | Agronomis | Ketik langsung di sel **Harga satuan** salah satu baris, tekan **Simpan perubahan**. | Kolom Jumlah dihitung ulang database. Jumlah tidak pernah bisa diketik langsung. | Critical |
| **R-24** | Agronomis | Tekan tombol **coret** (ikon mata) pada satu baris. | Baris tetap terlihat dengan coretan dan tulisan DICORET, tapi keluar dari Total RAB. | High |
| **R-25** | Agronomis | Tekan **hapus** (ikon tong sampah) pada baris yang salah masuk. | Baris hilang dari layar dan dari total. | High |
| **R-26** | Agronomis | Isi baris kosong di ujung tabel (tahap, bulan, kategori, uraian, volume, harga), tekan **Tambah**. | Baris masuk. Keyakinan tertulis "belum dinilai" dan sumber "belum disebutkan" — bukan diisi tebakan. | High |
| **R-27** | Agronomis | Buka form **Tambah komponen biaya**, periksa isian **Tahap** dan **Penggerak volume**. | Keduanya **dropdown tertutup**, bukan ketikan bebas. | Medium |
| **R-28** | Agronomis | Periksa dropdown **Satuan** di form yang sama. | Berisi pilihan dari master (HA, KG, HOK, BATANG…), tidak kosong. | High |

## E · Persetujuan, penugasan, realisasi

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-29** | Agronomis | Tekan **Ajukan ke finance**. | Status jadi *submitted*. Tabel komponen tidak lagi bisa disunting agronomis. | Critical |
| **R-30** | Agronomis | Setelah diajukan, coba cari tombol Setujui. | **Tidak ada** — penyusun tidak boleh memutuskan susunannya sendiri. | Critical |
| **R-31** | Approver | Buka RAB yang sama, tekan **Setujui**. | Status jadi *approved*. Panel **Penugasan lapangan** muncul. | Critical |
| **R-32** | Approver | Isi **Tanggal mulai proyek**, simpan. | Tersimpan, dan kurva S berhenti berkata "tanggal mulai belum ditetapkan". | Critical |
| **R-33** | Agronomis | Coba isi Tanggal mulai pada RAB yang sudah disetujui. | Form itu **tidak ditawarkan** kepada agronomis — hanya approver/super admin. | Medium |
| **R-34** | Agronomis | Tugaskan satu baris ke **Rizky Lapangan (creator)**, volume sebagian, isi target selesai. | Penugasan tersimpan dan tampil di daftar. | Critical |
| **R-35** | Agronomis | Tugaskan lagi baris yang sama dengan volume jauh melebihi volume barisnya. | **Ditolak**, dan pesannya **menyebut angkanya** (volume baris sekian, sudah tertugas sekian). | Critical |
| **R-36** | Agronomis | Periksa daftar penerima tugas. | Hanya berisi peran yang boleh mencatat realisasi (creator/approver/super admin). Viewer dan agronomis tidak muncul. | Medium |
| **R-37** | Creator | Buka **Pengeluaran**. Periksa dropdown **Realisasi dari penugasan RAB**. | Berisi penugasan yang diberikan kepadanya. Kalau ia tidak ditugasi apa pun, daftarnya kosong dengan keterangan — bukan hilang. | Critical |
| **R-38** | Creator | Catat pengeluaran dengan bukti, tautkan ke penugasan itu. | Tersimpan sebagai *draft*. | Critical |
| **R-39** | Approver | Buka RAB, lihat kartu **Terserap** sebelum pengeluaran disetujui. | Masih **—**. Pengeluaran yang belum diputuskan bukan serapan. | Critical |
| **R-40** | Approver | Setujui pengeluaran itu di Inbox Approval, lalu buka RAB lagi. | **Terserap** terisi sebesar nilainya, **Sisa** berkurang, kurva S bergerak. | Critical |

## F · Kurva S & serapan

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-41** | Approver | Kosongkan Tanggal mulai, muat ulang. | Kurva S **tidak digambar**, dan menjelaskan alasannya. Bukan grafik kosong tanpa keterangan. | High |
| **R-42** | Approver | Isi lagi tanggal mulai, perhatikan garis realisasi. | Garis berhenti di bulan terakhir yang punya catatan — tidak diteruskan mendatar ke bulan-bulan berikutnya. | High |
| **R-43** | Approver | Setujui pengeluaran yang nilainya melebihi anggaran barisnya. | **Sisa negatif**, ditandai merah. Tidak dijepit ke nol dan tidak disembunyikan. | Medium |
| **R-44** | Viewer | Buka RAB yang sudah disetujui. | Bisa melihat serapan dan kurva S, tapi tidak ada tombol menyunting apa pun. | High |

## G · Uji negatif — harus DITOLAK

| ID | Peran | Langkah | Hasil yang diharapkan | Prioritas |
|---|---|---|---|---|
| **R-45** | Creator | Buka `/costing/rencana-anggaran`. | Boleh melihat, tapi tidak ada tombol menyusun RAB. | High |
| **R-46** | Agronomis | Setelah RAB disetujui, coba ubah harga satuan salah satu baris lama. | **Ditolak** — baris yang ikut disetujui beku. | Critical |
| **R-47** | Approver | Pada RAB yang sudah disetujui, tambahkan baris baru, lalu ubah baris itu. | Menambah **boleh** (kesepakatan rapat 26 Agu); mengubah baris tambahannya sendiri juga boleh; mengubah baris lama **tidak**. | Critical |
| **R-48** | Agronomis | Impor berkas yang bukan template RAB (mis. berkas QA). | Ditolak dengan pesan yang menyebut sheet apa yang dibutuhkan. Tidak ada yang tersimpan. | Medium |
| **R-49** | Agronomis | Impor template dua kali ke RAB yang sama. | Pratinjau **memperingatkan** bahwa RAB sudah berisi komponen dan impor menambah, bukan mengganti. | High |
| **R-50** | Agronomis | Coba tugaskan pada RAB yang masih *draft*. | Panel penugasan **tidak muncul** sebelum RAB disetujui. | High |

---

## Yang sengaja BELUM ada — jangan ditandai FAIL

- **Sheet 06, 07, 09 tidak diimpor.** Peralatan, input pertanian, dan OPEX 10
  tahun memakai rentang tahun (T1…T10, umur manfaat) yang belum punya tempat di
  skema. Pratinjau menyebutkannya.
- **Sheet 03 (Land Screening) tidak diimpor.** Itu penyaring go/no-go sebelum
  RAB, bukan sheet anggaran.
- **Penggerak `sample`, `pit`, `ton`, `m` tidak ditautkan ke asumsi.**
  Hubungannya lewat pembagian atau rantai perhitungan, bukan kelipatan langsung.
- **Tidak ada NPV, IRR, arus kas, atau proyeksi pendapatan.** Dihapus lewat
  keputusan arsitektur #8 karena angkanya fabrikatif; jangan diminta kembali
  tanpa pembahasan.
- **Baris yang dicoret setelah punya realisasi** hilang dari laporan serapan.
  Diketahui, tiket tersendiri.
- **`start_date` masih bisa digeser** setelah ada realisasi, dan menggesernya
  menggeser seluruh kurva. Diketahui, tiket tersendiri.
