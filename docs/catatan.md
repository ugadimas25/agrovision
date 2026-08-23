# Catatan Perbaikan Fitur

Legenda: **[Bug]** tidak berfungsi sesuai harapan · **[Enhancement]** sudah jalan tapi perlu ditingkatkan · **[Klarifikasi]** butuh keputusan/informasi sebelum dikerjakan

---

## 1. Navigasi & Side Menu

- **[Enhancement]** Tombol dropdown di side menu tidak memberi indikasi aktif — hanya ikon panah. Perlu diputuskan: dibuat highlight/aktif, atau dibiarkan apa adanya. Karena jumlah menu cukup banyak, seluruh baris menu sebaiknya bisa diklik agar sidebar tidak terlalu panjang.
- **[Bug]** Ketika sub-menu sedang dipilih, menu induknya tidak bisa di-minimize.
- **[Enhancement]** Menu Pengaturan Blok & Peta, Survey Lapangan, dan Inbox Approval belum masuk ke dalam grup Pengaturan. Usul: digabung ke satu grup.

## 2. Dashboard (Operasional, Keberlanjutan, Keuangan)

- **[Bug]** Filter tidak berfungsi di ketiga dashboard — angka yang tampil statis.
- **[Enhancement]** Filter Estate, Periode, Blok, dan Komoditas perlu dibuat multi-pilih (checkbox / multi-select). Berlaku untuk semua dashboard.
- **[Klarifikasi]** Dashboard Keberlanjutan: konten perlu diverifikasi apakah bersumber dari data faktual atau masih placeholder.
- **[Enhancement]** Dashboard Finansial: pie chart struktur biaya perlu dipecah berdasarkan kategori biaya. Bagian insight & rekomendasi juga perlu disesuaikan.

## 3. Persiapan Lahan

- **[Enhancement]** Status masih menampilkan nilai mentah dari database (`ready_to_plant`, `in_progress`). Ganti dengan label berbahasa manusia yang layak tampil di UI.

## 4. Pembibitan

- **[Klarifikasi]** Alur modul belum jelas. Pertanyaan: apakah data bibit hanya bisa berasal dari Super Admin / Master Data?

## 5. Agri Input & Equipment

- **[Klarifikasi]** Perlu dipastikan apakah data yang sudah ada di list bisa di-edit.
- **[Enhancement]** Perlu dokumentasi biaya untuk Agri Input, dan hal yang sama untuk Equipment.

## 6. Akuntansi

### 6.1 Umum

- **[Klarifikasi]** Apakah modul ini perlu filter juga (Estate, Periode, Blok, Komoditas, dst)?

### 6.2 Refleksi Biaya — Penguncian Harga per Periode

- **[Enhancement]** Harga anggaran perlu dikunci per periode penganggaran. Perilaku yang diharapkan:
  - Harga yang dianggarkan berlaku untuk satu periode tertentu.
  - Bila harga berubah di periode berikutnya, data yang sudah terlanjur diinput **tidak ikut berubah**.
  - Data yang diinput setelah perubahan mengikuti harga baru.
  - Tujuannya agar perhitungan biaya mencerminkan kondisi riil.

### 6.3 Revenue

- **[Enhancement]** Header cukup ditulis "Revenue" saja tanpa keterangan tambahan. Jika penjelasan diperlukan, letakkan di bawah atau pakai ikon **i** dengan pop-up saat hover.
- **[Bug]** Penamaan kolom tidak konsisten: section-nya Revenue, tapi nama kolomnya "Tarif/Ton".
- **[Enhancement]** Komoditas dibuat bertingkat (parent–child). Contoh: Kelapa → sub grade A, B, C, masing-masing dengan harga per butir, lalu diakumulasi menjadi total revenue. Hasilnya lebih detail.
- **[Klarifikasi]** Struktur biaya perlu dicek dengan pendekatan yang sama.

### 6.4 Price List

- **[Enhancement]** Saat ini hanya kolom tarif yang bisa di-edit; baris lain tidak. Perlu diputuskan apakah edit per baris memang dibutuhkan.

### 6.5 Pengeluaran

- **[Enhancement]** Bagian biaya per blok (di bawah) perlu bisa di-edit.
- **[Enhancement]** Filter sudah berfungsi, tapi memicu refresh satu halaman penuh. Idealnya hanya section terkait yang di-refresh.
- **[Enhancement]** Sorting per kolom perlu diaktifkan — misalnya klik header Tanggal untuk toggle asc/desc.
- **[Bug]** Data dengan status Ditolak juga tidak bisa di-edit.

### 6.6 Pendapatan

- **[Enhancement]** Harga sebaiknya dipecah per grade. Catatan: kemungkinan menambah skema database.
- **[Bug]** Penamaan kolom: pada modul Pendapatan seharusnya "Harga", bukan "Tarif/Ton".
- **[Enhancement]** Header section cukup "Pendapatan" saja, tanpa rumus `per komoditas = tonase × tarif`. Rumus dipindah ke ikon **i** yang muncul saat hover.
- **[Klarifikasi]** Istilah "Tarif Komoditas" — apakah maksudnya "Harga Komoditas"? Nilainya bisa dipecah per komoditas lalu per grade, dan di-set di awal.

### 6.7 Budget

- **[Bug]** Kalkulasi budget belum ter-link. Perlu dihubungkan sampai ke realisasi dan pengeluaran, baik per periode maupun per blok.
- **[Enhancement]** Form susun anggaran dibuat dinamis mengikuti lingkup/scope yang dipilih:
  - Scope Estate → tampilkan pilihan Estate
  - Scope Blok → tampilkan pilihan Blok
  - Scope Semua → tampilkan Estate dan Blok
- **[Enhancement]** Hasilnya perlu direkonsiliasi dengan data realisasi.

## 7. Reports

- **[Klarifikasi]** Tampilan saat ini terlalu padat dan membingungkan. Perlu sesi terpisah untuk menentukan laporan apa saja yang benar-benar dibutuhkan dan formatnya.

## 8. Master Data

- **[Enhancement]** Form perlu disesuaikan per judul/entitas. Saat ini semua entitas memakai form yang sama.
- **[Enhancement]** Pada Kategori Biaya (dan komponen sejenis lainnya) hanya tersedia action "Nonaktifkan". Perlu ditambah action **Edit** agar data bisa diubah tanpa harus dihapus.

## 9. Users & Access

- **[Bug]** Tidak ada action button di setiap baris — user tidak bisa dihapus maupun dinonaktifkan.
- **[Enhancement]** Saat user dinonaktifkan, status di database menjadi non-aktif; perlu action button untuk mengaktifkan kembali.
- **[Bug]** Belum ada pemetaan role terhadap menu yang boleh diakses. Saat ini petugas lapangan bisa mengakses seluruh menu — ini masalah keamanan, bukan sekadar kenyamanan.

## 10. Field Survey

- **[Enhancement]** Perlu action **View** agar hasil survei bisa dilihat.

## 11. Approval Inbox

- **[Enhancement]** Setelah action dilakukan, item langsung hilang dari daftar. Idealnya item dipindah ke bagian bawah agar terlihat mana saja yang sudah di-approve.
- **[Enhancement]** Tambahkan sort dan filter.
- **[Enhancement]** Default urutan: tanggal, descending.
