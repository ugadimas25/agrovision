# TIKET-01 · QA Manual End-to-End — AgroVision

| | |
|---|---|
| **Assignee** | Harits Balfas (`haritshb`) |
| **Reviewer** | @ugadimas25 |
| **Prioritas** | High |
| **Estimasi** | 3–4 hari kerja |
| **Tipe** | QA / Testing |
| **Tags** | `qa`, `approval`, `mobile`, `pwa` |
| **Branch** | `qa/manual-e2e-round-1` |
| **Berkas kerja** | `docs/QA-Manual-AgroVision.xlsx` |

---

## Tujuan

Memverifikasi secara manual bahwa:

1. Alur approval berjalan utuh di semua modul (draft → diajukan → disetujui/ditolak).
2. Hak akses tiap role benar-benar ditegakkan — bukan sekadar tombol yang disembunyikan.
3. Seluruh fitur berfungsi di desktop **dan** mobile.

Keluaran: tabel hasil uji terisi penuh + daftar bug yang langsung bisa dikerjakan developer.

---

## Prasyarat

**URL aplikasi**

```
https://agrovision-393569486275.asia-southeast2.run.app
```

**Akun uji** — login tanpa password, cukup ketik email:

| Email | Nama | Role |
|---|---|---|
| `admin@demo.invalid` | Sari Admin | Super Admin |
| `approver@demo.invalid` | Budi Approver | Approver |
| `creator@demo.invalid` | Rizky Lapangan | Creator (petugas lapangan) |
| `direktur@demo.invalid` | Dewi Direktur | Viewer |

**Perangkat wajib**

- Android Chrome (375px)
- iPhone Safari (375px)
- Desktop Chrome (1440px)
- Tablet / DevTools (768px)

Semua data bertanda `is_demo = true` — **aman diubah, dirusak, dan dicoba-coba**.

---

## ⚠️ Blocker yang sudah diketahui — baca sebelum mulai

Audit kode menemukan **tombol "Setujui" hanya berfungsi untuk modul Pengeluaran**. Form approve tidak mengirim `moduleKey`, sehingga 10 modul lain selalu gagal dengan pesan:

> Tidak bisa diputuskan — statusnya bukan menunggu approval.

Tombol "Tolak" tetap normal.

Sudah dibuatkan **TIKET-B5** (`fix/approve-modulekey`, ±30 menit). Skenario **B-02 s.d. B-11 akan gagal** sampai tiket itu selesai — tandai `BLOCKED`, **jangan** dicatat sebagai bug baru.

---

## Ruang lingkup — 63 skenario, 8 kelompok

Tabel lengkap ada di **`docs/QA-Manual-AgroVision.xlsx`** (sheet *Skenario QA*), dengan kolom: ID · Menu (grup) · Modul/Layar · Path URL · Role · Skenario · Langkah Uji · Data Uji · Hasil Diharapkan · Prioritas · Status · Perangkat · Tanggal · Catatan · Ref Bug.

| Kel. | Area | Jml | Fokus |
|---|---|---|---|
| **A** | Autentikasi & Role | 7 | Login 4 role, viewer read-only, creator tak bisa approve, isolasi antar entitas |
| **B** | Approval End-to-End | 18 | Alur penuh di 11 modul, tolak wajib alasan, ajukan ulang, efek ke laporan, uji self-approval |
| **C** | Pra-Tanam & Aktivitas Kebun | 8 | Peta & layer, Hitung kesesuaian, Generate rekomendasi pemupukan, nursery |
| **D** | Agri-Input & Keberlanjutan | 5 | Stok & reorder alert, karbon, sertifikasi, traceability |
| **E** | Akuntansi | 5 | Refleksi biaya, pendapatan, anggaran, kejujuran data, bukti wajib |
| **F** | Laporan & Ekspor | 5 | 3 dashboard, 18 layar laporan, ekspor PDF & Excel, konsistensi angka |
| **G** | Mobile & PWA | 10 | Install, offline, drawer, tabel→kartu, form, kamera struk, peta 2 jari |
| **H** | Negatif & Ketahanan | 5 | Validasi, file >8MB, klik ganda, tombol back, bahasa ID/EN |

### Skenario prioritas Critical (kerjakan lebih dulu)

`A-01` login tiap role · `A-03` viewer read-only · `A-04` creator tak bisa approve · `A-07` isolasi entitas · `B-01` pengeluaran alur penuh · `B-02` pemupukan · `B-03` panen + revenue · `B-12` tolak wajib alasan · `B-15` kelengkapan Inbox · `B-17` approval mengubah angka laporan · `B-18` self-approval · `C-03` Hitung kesesuaian · `C-05` Generate rekomendasi pemupukan · `E-01` refleksi biaya · `E-02` revenue panen · `F-05` konsistensi angka

---

## Cara mengisi

1. Buka `docs/QA-Manual-AgroVision.xlsx`, sheet **Skenario QA**.
2. Kerjakan berurutan per kelompok (A → H).
3. Isi kolom **Status** dari dropdown: `PASS` / `FAIL` / `BLOCKED` / `SKIP`.
4. Isi **Perangkat Diuji** dan **Tanggal**.
5. Setiap `FAIL` dicatat di sheet **Log Bug**, lalu nomor bugnya ditulis di kolom **Ref Bug**.
6. Kolom **Catatan** dipakai untuk hal yang perlu diketahui walau statusnya `PASS`.

---

## Format laporan bug

Setiap `FAIL` dibuat sebagai subtask, judul: `[ID uji] Ringkasan singkat`.

```
ID uji     : B-03
Perangkat  : iPhone 13 / Safari 17 · 375px
Role       : approver@demo.invalid
Langkah    : 1) Buka Approval Inbox
             2) Tekan "Setujui" pada baris Panen
Diharapkan : Status berubah jadi Disetujui
Aktual     : Muncul "Tidak bisa diputuskan — statusnya bukan menunggu approval"
Severity   : Critical / High / Medium / Low
Lampiran   : screenshot / rekaman layar
```

---

## Hal yang mudah terlewat

- **Kejujuran data** — nilai kosong **harus** ditulis `—`, tidak boleh `0`. Kalau menemukan `0` padahal datanya memang belum ada, itu `FAIL`.
- **Server harus menolak, bukan sekadar menyembunyikan tombol.** Untuk `A-03` dan `A-04`, jangan berhenti pada "tombolnya tidak ada" — kalau bisa, coba akses URL modulnya langsung.
- **Ekspor PDF tetap A4.** Tampilan layar boleh menyesuaikan mobile, tapi file PDF-nya tidak boleh ikut mengecil.
- **Refresh keras di HP.** Aplikasi ini PWA — service worker menyimpan versi lama. Tutup total aplikasi lalu buka lagi setiap kali ada deploy baru.

---

## Definition of Done

- [ ] Seluruh baris tabel terisi `PASS` / `FAIL` / `BLOCKED` / `SKIP` — tidak ada yang kosong
- [ ] Diuji minimal di Android Chrome + iPhone Safari + desktop Chrome
- [ ] Setiap `FAIL` punya entri di sheet **Log Bug** dengan langkah reproduksi + screenshot
- [ ] Ringkasan akhir: jumlah pass/fail, daftar bug Critical & High, dan penilaian **"layak demo / belum"**

---

## Catatan penting

> **Autentikasi (per 26 Agu 2026).** Verifikasi ID token Identity Platform sudah terpasang di kode (B-27), dan build produksi **tidak akan lagi melayani login tanpa kata sandi**. Selama instance QA di atas belum dipasangi Identity Platform (mengaktifkan penyedia email/kata sandi + memasang `external_id` tiap akun demo — `docs/12-deploy-gcp.md` §9), **login akan menolak** dengan pesan "Login belum dikonfigurasi …". Itu bukan bug untuk dilaporkan: tanyakan ke Dimas apakah instance QA sudah disiapkan sebelum memulai sesi QA.
>
> Selama datanya masih dataset demo, **jangan memasukkan data sungguhan** ke aplikasi.
