-- ===========================================================================
-- 0046 — AI-44a: satu tarif aktif per (entitas, driver, bahan).
--
-- Migrasi 0041 memberi app.price_list sebuah kolom `driver` dan fungsi
-- app.price_for_driver() yang memilih baris tarif dengan LIMIT 1:
--
--     ORDER BY (pl.chemical_id = p_chemical) DESC NULLS LAST, pl.code
--     LIMIT 1
--
-- LIMIT 1 itu MENGANDAIKAN hanya ada satu kandidat generik. Andaian itu tidak
-- pernah ditegakkan. Kalau ada dua baris aktif dengan driver sama dan
-- chemical_id sama, pemenangnya ditentukan urutan KODE — jadi biaya yang
-- dimaterialisasi app.decide_record() bergantung pada nama kode, bukan pada
-- fakta ekonomi. Selama tarif hanya bisa lahir dari seed hal itu tidak pernah
-- terjadi; AI-44a membuka jalur create dari UI, sehingga andaian itu harus
-- menjadi invarian database sebelum jalurnya dibuka.
--
-- Sekaligus menutup penggandaan di sisi tampilan: reflectedCosts() menghitung
-- volume per driver SEKALI lalu mengalikannya ke baris tarif. Dua baris aktif
-- ber-driver sama berarti volume yang sama dikalikan dua kali.
--
-- chemical_id IKUT dalam kunci, bukan diabaikan: tarif per bahan adalah desain
-- 0041 yang disengaja (komentar price_for_driver: "baris ber-chemical_id yang
-- cocok menang atas baris generik"). NULLS NOT DISTINCT (PostgreSQL 15+) dipakai
-- supaya DUA baris generik (chemical_id NULL) tetap bertabrakan — tanpa itu NULL
-- dianggap berbeda dari NULL dan justru kasus yang paling mungkin lolos.
--
-- Cakupan indeks sengaja sempit:
--   * valid_to IS NULL — hanya versi yang masih berlaku. Versi lama WAJIB boleh
--     berbagi driver, itu justru gunanya penomoran versi (K-02 §14).
--   * is_active — baris yang dinonaktifkan tidak ikut dihitung dan tidak dipilih
--     price_for_driver, jadi ia tidak boleh memblokir penggantinya. Ini yang
--     membuat aturan K-09 "driver salah = baris baru + baris lama is_active
--     false" bisa dijalankan.
--   * kind = 'cost' — price_for_driver menyaring kind='cost'; baris revenue
--     tidak pernah dipilih lewat driver.
-- ===========================================================================

-- Kanari maju: kalau data yang ADA sudah melanggar, gagalkan di sini dengan
-- pesan yang menyebut barisnya, bukan dengan galat indeks yang tidak informatif.
DO $$
DECLARE r record; pesan text := '';
BEGIN
  FOR r IN
    SELECT company_id, driver, chemical_id, count(*) AS n,
           string_agg(code, ', ' ORDER BY code) AS codes
      FROM app.price_list
     WHERE driver IS NOT NULL AND valid_to IS NULL AND is_active AND kind = 'cost'
     GROUP BY company_id, driver, chemical_id
    HAVING count(*) > 1
  LOOP
    pesan := pesan || format(E'\n  entitas %s driver %s: %s baris (%s)',
                             r.company_id, r.driver, r.n, r.codes);
  END LOOP;
  IF pesan <> '' THEN
    RAISE EXCEPTION 'tarif aktif ganda per driver — nonaktifkan yang lama lebih dulu:%', pesan;
  END IF;
END $$;

CREATE UNIQUE INDEX price_list_one_active_per_driver_idx
  ON app.price_list (company_id, driver, chemical_id) NULLS NOT DISTINCT
  WHERE driver IS NOT NULL AND valid_to IS NULL AND is_active AND kind = 'cost';

COMMENT ON INDEX app.price_list_one_active_per_driver_idx IS
  'AI-44a: satu tarif aktif per (entitas, driver, bahan). Menegakkan andaian '
  'LIMIT 1 di app.price_for_driver() dan mencegah volume dihitung dua kali di '
  'reflectedCosts(). Versi lama (valid_to terisi) dan baris nonaktif dikecualikan.';

-- ===========================================================================
-- Kanari kesehatan (pola 0039–0045)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0046', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0046', n;
  END IF;
END $$;
