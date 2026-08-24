-- ===========================================================================
-- 0050 — tipe master "Layout Tanam", supaya Jarak Tanam berhenti dikarang.
--
-- Kolom `land_preparations.planting_layout_item_id` sudah ada sejak awal dan
-- ber-FK ke app.master_items — tapi TIDAK ADA tipe master untuknya, tidak ada
-- field di form yang mengisinya, dan 0 dari 13 baris demo terisi. Akibatnya
-- laporan Persiapan Lahan mencetak literal '3 m × 3 m' untuk SETIAP baris
-- (13 dari 13, terverifikasi lewat ekspor Excel) — spesifikasi agronomi yang
-- terlihat seperti data blok itu, padahal tidak pernah dibaca dari mana pun.
--
-- Mengikuti pola 0015: yang diseed hanya STRUKTURNYA. Isinya (master_items)
-- sengaja dibiarkan kosong supaya super_admin membuatnya lewat UI Master Data —
-- itu doktrin yang sama dengan 12 tipe lain dan yang dibuktikan acceptance test 1.
-- `db:seed:demo` mengisi beberapa contoh khusus untuk tenant demo.
--
-- is_system = true: tipe ini dirujuk FK dari land_preparations, jadi tidak boleh
-- dihapus lewat UI (dijaga policy master_types dari 0018).
-- ===========================================================================

INSERT INTO app.master_types (code, name, description, is_hierarchical, is_system)
VALUES ('planting_layout', 'Layout Tanam',
        'Jarak/pola tanam per blok, mis. 3 m × 3 m. Dirujuk land_preparations.planting_layout_item_id.',
        false, true)
ON CONFLICT (code) DO NOTHING;

-- ===========================================================================
-- Kanari kesehatan (pola 0039–0049)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0050', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0050', n;
  END IF;
END $$;
