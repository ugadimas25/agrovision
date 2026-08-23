# Ringkasan Meeting

## Informasi Meeting

- **Tanggal:** 21 Agustus 2026
- **Durasi:** ±1 jam 7 menit
- **Peserta:** Dimas Perceka, Haris, dan Ridwan Nulloh
- **Fokus:** QA aplikasi, alur approval, hak akses, konsistensi perhitungan, dan kesiapan infrastruktur

## Hasil Utama

### 1. Alur draft dan approval

- Proses **simpan draft → ajukan → approval** sudah berjalan, tetapi alur untuk data yang ditolak belum benar.
- Data yang ditolak harus kembali menjadi **draft yang dapat diedit**, kemudian dapat diajukan ulang.
- Approver wajib memberikan alasan ketika menolak pengajuan.
- Inbox approval perlu menyimpan **riwayat pengajuan yang telah diproses**, bukan langsung menghilangkannya setelah disetujui atau ditolak.
- Approval saat ini hanya satu tingkat; approval berjenjang belum diperlukan.

### 2. Pembagian role dan hak akses

- **Petugas lapangan/creator:** mencatat dan mengajukan data serta hanya dapat melihat data miliknya sendiri.
- **Approver:** melihat, menyetujui, atau menolak pengajuan, tetapi tidak membuat catatan operasional.
- **Admin:** memiliki akses yang lebih luas terhadap data dan konfigurasi sistem.
- Menu petugas lapangan perlu disederhanakan agar hanya menampilkan fitur yang relevan.

### 3. Mandatory field dan kalkulasi biaya

Beberapa field penting masih belum mandatory, antara lain:

- luas area;
- jumlah tenaga/orang;
- jumlah pohon;
- volume dan satuan;
- komponen rekomendasi pemupukan.

Nilai biaya operasional direncanakan menggunakan perhitungan:

> **Biaya = volume × tarif/harga**

### 4. Konsistensi budget dan realisasi

- Ditemukan perbedaan angka antara tampilan creator/petugas lapangan dan approver.
- Perbedaan mencakup nilai anggaran, tonase, dan total biaya.
- Beberapa hasil rumus tidak sesuai dengan perhitungan manual.
- Satu aktivitas dapat menampilkan dua angka berbeda pada role yang berbeda.
- Nilai realisasi masih nol meskipun aktivitas operasional telah dicatat.
- Rumus budget dan mekanisme realisasi perlu diperiksa dan dikonfirmasi kembali.

## Temuan Fitur dan QA

- Sejumlah halaman belum mempunyai tombol atau fitur **Catat**, termasuk beberapa aktivitas pembibitan.
- Beberapa proses approval mengalami **infinite loading**, tetapi masalahnya belum terjadi secara konsisten.
- Modul rekomendasi pemupukan belum menghasilkan data sehingga sebagian skenario belum dapat diuji.
- Sertifikasi belum mendukung penambahan data dengan jelas.
- Fitur traceability belum dapat menggambar atau memilih garis alur, padahal diperlukan untuk menunjukkan perpindahan antaraktor.
- Survei lapangan belum terhubung dengan mekanisme approval dan harus disambungkan.
- Menu pengeluaran terpisah memang tidak digunakan karena biaya direfleksikan dari aktivitas operasional.
- Aktivitas yang menimbulkan biaya tetap harus menyediakan fitur untuk mengunggah bukti, seperti nota, foto, PDF, atau dokumen lainnya.
- Dari sekitar **71 skenario pengujian**, sekitar **48–49 skenario** telah diperiksa. Seluruh temuan perlu dirapikan sebelum dijadikan tiket.

## Infrastruktur dan Pengembangan

- Tombol approval yang sebelumnya error telah diperbaiki dan diuji kembali.
- Pipeline CI telah mencakup proses build, test, verification, dan migrasi database.
- Perubahan skema melalui file migrasi akan dijalankan otomatis saat deployment.
- File bukti belum persisten karena masih tersimpan pada instance aplikasi dan dapat hilang saat rebuild.
- Perlu dibuat **cloud storage bucket** untuk menyimpan evidence secara permanen.
- Perlu disiapkan database atau schema baru yang bersih agar pengujian tidak terpengaruh data lama.
- Database existing dapat dijadikan development/staging, sedangkan database bersih digunakan untuk pengujian atau production.

## Tindak Lanjut

| PIC | Tindak lanjut |
|---|---|
| Dimas | Merapikan transkrip dan mengubah temuan menjadi daftar task/tiket dalam file Markdown. |
| Dimas | Meninjau frontend untuk menentukan penempatan fitur upload bukti pada aktivitas terkait. |
| Dimas | Memeriksa rumus budget, realisasi, dan perbedaan angka antar-role. |
| Haris | Menyelesaikan dan merapikan hasil QA, termasuk penandaan skenario yang bermasalah. |
| Haris | Menaruh dokumen QA di Google Drive agar dapat dikerjakan bersama. |
| Ridwan | Membuat cloud storage bucket untuk evidence. |
| Ridwan | Menyiapkan database/schema bersih dan mengarahkan aplikasi ke database tersebut. |
| Ridwan | Menghubungkan survei lapangan dengan alur approval. |
| Ridwan | Mengerjakan item sprint terkait, terutama B8–B11; B12 menunggu finalisasi alur berdasarkan hasil meeting. |
| Tim | Menyelesaikan QA hingga seluruh test case berstatus hijau sebelum aplikasi diserahkan untuk UAT. |

## Target Terdekat

- Daftar task dalam format Markdown dibagikan **sebelum akhir pekan** agar pekerjaan teknis dapat dilanjutkan pada akhir pekan.
- Tim memiliki waktu sekitar **dua minggu lagi** untuk menyelesaikan pekerjaan sesuai kesepakatan durasi satu bulan.

## Catatan

Ringkasan ini disusun dari transkrip otomatis. Beberapa istilah atau nomor tiket perlu dikonfirmasi kembali karena terdapat bagian transkrip yang kurang jelas.
