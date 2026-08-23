-- ===========================================================================
-- 0049 — tarif boleh dikoreksi pada hari penerbitannya (temuan telaah adversarial).
--
-- Sebelum ini `publish_price` menolak valid_from yang tidak LEBIH BESAR dari tepi
-- terakhir. Karena penerbitan hari ini menjadikan hari ini sebagai tepi terakhir,
-- salah ketik tarif baru bisa diperbaiki BESOK. Satu-satunya jalan sekarang adalah
-- menonaktifkan baris itu dan membuat kode baru -- mengotori katalog karena typo.
--
-- Aturan K-02 "timeline hanya boleh maju" TIDAK dilonggarkan untuk versi lain:
-- yang boleh diperbaiki hanya versi TERBUKA yang valid_from-nya hari ini, pada
-- hari itu juga. Selebihnya tetap ditolak.
--
-- Fungsi disalin dari keadaan berjalan (0041 §5) lalu disisipi satu cabang;
-- selain cabang itu tidak ada yang berubah.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.publish_price(p_code text, p_rate_idr numeric, p_valid_from date, p_unit text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_driver text DEFAULT NULL::text, p_cost_category_id uuid DEFAULT NULL::uuid, p_chemical_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'pg_catalog'
AS $function$
DECLARE
  v_actor     uuid := app.current_user_id();
  v_company   uuid := COALESCE(p_company_id, app.current_company_id());
  v_base      app.price_list;
  v_last_edge date;
  v_next      integer;
  v_id        uuid;
BEGIN
  IF app.current_role_name() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'hanya super_admin boleh menerbitkan tarif (K-06 Keputusan 3)';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'konteks sesi wajib — penerbitan tarif harus dapat diatribusikan';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'entitas wajib — pilih satu entitas atau isi p_company_id';
  END IF;
  IF NOT app.company_in_scope(v_company) THEN
    RAISE EXCEPTION 'entitas % di luar akses Anda', v_company;
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'code wajib';
  END IF;
  IF p_rate_idr IS NULL OR p_rate_idr < 0 THEN
    RAISE EXCEPTION 'rate_idr harus >= 0 (diberikan: %)', p_rate_idr;
  END IF;
  IF p_valid_from IS NULL THEN
    RAISE EXCEPTION 'valid_from wajib';
  END IF;

  -- versi terbaru sebagai baseline pewarisan field
  SELECT * INTO v_base FROM app.price_list
   WHERE company_id = v_company AND code = p_code
   ORDER BY version DESC LIMIT 1;

  IF v_base.id IS NULL THEN
    -- ===== kode baru: versi 1 (jalur create AI-44a) =====
    IF p_kind IS NULL OR p_kind NOT IN ('cost', 'revenue') THEN
      RAISE EXCEPTION 'kind (cost|revenue) wajib untuk kode baru';
    END IF;
    IF p_category IS NULL OR btrim(p_category) = '' THEN
      RAISE EXCEPTION 'category wajib untuk kode baru';
    END IF;
    IF p_unit IS NULL OR btrim(p_unit) = '' THEN
      RAISE EXCEPTION 'unit wajib untuk kode baru';
    END IF;
    INSERT INTO app.price_list
      (company_id, code, kind, category, driver, unit, rate_idr, note, is_active,
       version, valid_from, valid_to, cost_category_id, chemical_id, updated_at, updated_by)
    VALUES
      (v_company, p_code, p_kind, p_category, p_driver, p_unit, p_rate_idr, p_note, true,
       1, p_valid_from, NULL, p_cost_category_id, p_chemical_id, now(), v_actor)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- ===== kode lama: field kekal tidak boleh dibelokkan lewat parameter =====
  IF p_kind IS NOT NULL AND p_kind IS DISTINCT FROM v_base.kind THEN
    RAISE EXCEPTION 'kind kekal (K-09): % tidak bisa menjadi %', v_base.kind, p_kind;
  END IF;
  IF p_driver IS NOT NULL AND p_driver IS DISTINCT FROM v_base.driver THEN
    RAISE EXCEPTION 'driver kekal (K-09): buat baris kode baru dan nonaktifkan yang lama';
  END IF;

  -- ===== KOREKSI HARI YANG SAMA (temuan telaah adversarial 24 Agu 2026) =====
  -- Sebelum ini salah ketik tarif tidak bisa diperbaiki pada hari penerbitannya:
  -- valid_from wajib LEBIH BESAR dari tepi terakhir, dan tepi terakhir baru saja
  -- menjadi hari ini. Satu-satunya jalan adalah menonaktifkan barisnya dan membuat
  -- kode baru -- mengotori katalog karena sebuah typo.
  --
  -- Yang diizinkan SANGAT sempit: memperbaiki versi TERBUKA yang valid_from-nya
  -- hari ini, pada hari itu juga. Versi yang sudah berjalan sejak tanggal lain
  -- tetap tidak bisa disentuh -- itu inti K-02, dan melonggarkannya berarti menulis
  -- ulang nilai historis.
  --
  -- Zona operasional, BUKAN CURRENT_DATE: server berjalan UTC, dan antara 00:00-07:00
  -- WIB CURRENT_DATE masih tanggal kemarin. Memakai CURRENT_DATE membuat jendela
  -- koreksi ini salah tepat pada jam yang paling mungkin dipakai orang kebun.
  --
  -- Riwayat biaya tetap aman: cost_transactions menyimpan unit_price_idr sebagai
  -- SNAPSHOT saat approval, jadi biaya yang sudah materialisasi memakai tarif yang
  -- benar-benar berlaku saat itu dan tidak berubah oleh koreksi ini. Perubahannya
  -- sendiri tercatat trigger price_list_audit.
  IF v_base.valid_to IS NULL
     AND v_base.valid_from = (now() AT TIME ZONE 'Asia/Jakarta')::date
     AND p_valid_from = v_base.valid_from THEN
    UPDATE app.price_list
       SET rate_idr         = p_rate_idr,
           unit             = COALESCE(p_unit, unit),
           note             = COALESCE(p_note, note),
           cost_category_id = COALESCE(p_cost_category_id, cost_category_id),
           chemical_id      = COALESCE(p_chemical_id, chemical_id),
           updated_at = now(), updated_by = v_actor
     WHERE id = v_base.id
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- Timeline hanya boleh maju (K-02 aturan 2 — backdating dilarang).
  -- GREATEST mengabaikan NULL, jadi kode yang sudah tertutup pun terjaga.
  SELECT GREATEST(max(valid_from), max(valid_to)) INTO v_last_edge
    FROM app.price_list WHERE company_id = v_company AND code = p_code;
  IF p_valid_from <= v_last_edge THEN
    RAISE EXCEPTION 'backdating dilarang (K-02 aturan 2): valid_from (%) harus setelah %',
      p_valid_from, v_last_edge;
  END IF;

  -- tutup versi terbuka (bila ada)
  UPDATE app.price_list
     SET valid_to = p_valid_from - 1, updated_at = now(), updated_by = v_actor
   WHERE company_id = v_company AND code = p_code AND valid_to IS NULL;

  SELECT COALESCE(max(version), 0) + 1 INTO v_next
    FROM app.price_list WHERE company_id = v_company AND code = p_code;

  INSERT INTO app.price_list
    (company_id, code, kind, category, driver, unit, rate_idr, note, is_active,
     version, valid_from, valid_to, cost_category_id, chemical_id, updated_at, updated_by)
  VALUES
    (v_company, p_code, v_base.kind, v_base.category, v_base.driver,
     COALESCE(p_unit, v_base.unit), p_rate_idr, COALESCE(p_note, v_base.note),
     v_base.is_active, v_next, p_valid_from, NULL,
     COALESCE(p_cost_category_id, v_base.cost_category_id),
     COALESCE(p_chemical_id, v_base.chemical_id), now(), v_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- ===========================================================================
-- Kanari kesehatan (pola 0039–0048)
-- ===========================================================================

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0049', n;
  END IF;
  SELECT count(*) INTO n FROM app.check_privilege_revocations();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_privilege_revocations() mengembalikan % baris setelah 0049', n;
  END IF;
END $$;
