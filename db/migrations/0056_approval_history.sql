-- 0056_approval_history.sql
-- B-22: Inbox approval tidak menyimpan riwayat. Begitu decide_record()
-- memutuskan sesuatu, baris itu lenyap dari app.v_pending_approvals (yang
-- memang hanya menampilkan submitted/under_review) tanpa jejak di UI mana
-- pun -- approver tak bisa melihat lagi apa yang pernah ia setujui/tolak.
--
-- OPSI A dipilih (bukan menghidupkan approval_requests/approval_steps,
-- lihat B-11): app.audit_log SUDAH memuat aktor + waktu + before/after
-- setiap UPDATE approval_status, berkat trigger write_audit() yang dipasang
-- B-8 (migrasi 0053) ke 11 tabel ber-approval_status. Riwayat dibaca ulang
-- dari situ -- tidak ada tabel baru, tidak ada kolom baru.
--
-- v_pending_approvals SENGAJA TIDAK disentuh sama sekali di migrasi ini --
-- perilaku Inbox default (hanya yang menunggu) tetap sama persis, dan
-- gotcha security_invoker view itu tidak berlaku karena viewnya tidak
-- di-CREATE OR REPLACE.
--
-- Lingkup kepemilikan (creator hanya lihat riwayatnya sendiri, approver/
-- super_admin/viewer lihat seluruh tenant) TIDAK butuh policy RLS baru:
-- view ini security_invoker=true dan setiap cabang JOIN ke tabel modul
-- asal, yang sejak migrasi 0054 (B-23) sudah punya RESTRICTIVE SELECT
-- policy per-creator. audit_log sendiri hanya dibatasi per-tenant (migrasi
-- 0012) -- itu cukup, karena JOIN ke tabel modul yang sudah dipersempit
-- otomatis mempersempit hasil gabungannya juga.

CREATE VIEW app.v_approval_history AS
  SELECT 'cost_transaction'::text AS module_key, 'Pengeluaran'::text AS module_label,
    ct.id AS record_id, b.code AS block_code, cat.name AS detail, ct.amount_idr,
    ct.transaction_date AS event_date, ct.approval_status AS current_status,
    al.diff->'after'->>'approval_status' AS decision,
    al.diff->'after'->>'rejection_reason' AS rejection_reason,
    du.full_name AS decided_by_name, al.occurred_at AS decided_at,
    cu.full_name AS created_by_name
   FROM app.cost_transactions ct
     JOIN app.audit_log al ON al.entity_type = 'cost_transactions' AND al.entity_id = ct.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     LEFT JOIN app.blocks b ON b.id = ct.block_id
     LEFT JOIN app.master_items cat ON cat.id = ct.cost_category_id
     LEFT JOIN app.users cu ON cu.id = ct.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'fertilizer_application', 'Pemupukan',
    fa.id, b.code, (ft.name || ' — ' || fa.total_quantity) || ' ' || COALESCE(uom.name,''), NULL::numeric,
    fa.applied_on, fa.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.fertilizer_applications fa
     JOIN app.audit_log al ON al.entity_type = 'fertilizer_applications' AND al.entity_id = fa.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = fa.block_id
     JOIN app.fertilizer_types ft ON ft.id = fa.fertilizer_type_id
     LEFT JOIN app.master_items uom ON uom.id = fa.uom_item_id
     LEFT JOIN app.users cu ON cu.id = fa.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'land_preparation', 'Persiapan Lahan',
    lp.id, b.code, 'Checklist — ' || COALESCE(lp.planting_hole_count::text,'?') || ' lubang tanam', NULL::numeric,
    lp.checked_at::date, lp.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.land_preparations lp
     JOIN app.audit_log al ON al.entity_type = 'land_preparations' AND al.entity_id = lp.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = lp.block_id
     LEFT JOIN app.users cu ON cu.id = lp.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'land_suitability_assessment', 'Kesesuaian Lahan',
    lsa.id, b.code,
    ('Skor durian ' || COALESCE(lsa.score_durian::text,'—')) || ' / kelapa ' || COALESCE(lsa.score_coconut::text,'—'),
    NULL::numeric, lsa.assessed_at::date, lsa.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.land_suitability_assessments lsa
     JOIN app.audit_log al ON al.entity_type = 'land_suitability_assessments' AND al.entity_id = lsa.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = lsa.block_id
     LEFT JOIN app.users cu ON cu.id = lsa.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'pruning_record', 'Pruning',
    pr.id, b.code, COALESCE(pr.tree_count::text || ' pohon','Pruning'), NULL::numeric,
    pr.pruned_on, pr.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.pruning_records pr
     JOIN app.audit_log al ON al.entity_type = 'pruning_records' AND al.entity_id = pr.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = pr.block_id
     LEFT JOIN app.users cu ON cu.id = pr.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'nursery_inspection', 'Inspeksi Bibit',
    ni.id, sb.code,
    ((('Hidup ' || ni.qty_alive) || ' · mati ' || ni.qty_dead) || ' · rusak ') || ni.qty_damaged,
    NULL::numeric, ni.inspected_at::date, ni.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.nursery_inspections ni
     JOIN app.audit_log al ON al.entity_type = 'nursery_inspections' AND al.entity_id = ni.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.seed_batches sb ON sb.id = ni.seed_batch_id
     LEFT JOIN app.users cu ON cu.id = ni.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'dbh_measurement', 'Pengukuran DBH',
    dm.id, b.code, ('DBH ' || dm.dbh_cm) || ' cm', NULL::numeric,
    dm.measured_at::date, dm.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.dbh_measurements dm
     JOIN app.audit_log al ON al.entity_type = 'dbh_measurements' AND al.entity_id = dm.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = dm.block_id
     LEFT JOIN app.users cu ON cu.id = dm.measured_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'survey_submission', 'Survei',
    ss.id, b.code, f.name, NULL::numeric,
    ss.submitted_at::date, ss.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.survey_submissions ss
     JOIN app.audit_log al ON al.entity_type = 'survey_submissions' AND al.entity_id = ss.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.form_versions fv ON fv.id = ss.form_version_id
     JOIN app.forms f ON f.id = fv.form_id
     LEFT JOIN app.blocks b ON b.id = ss.block_id
     LEFT JOIN app.users cu ON cu.id = ss.submitted_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'weeding_record', 'Penyiangan',
    w.id, b.code, 'Penyiangan' || COALESCE((' · ' || w.area_ha::text) || ' ha',''), NULL::numeric,
    w.weeded_on, w.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.weeding_records w
     JOIN app.audit_log al ON al.entity_type = 'weeding_records' AND al.entity_id = w.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = w.block_id
     LEFT JOIN app.users cu ON cu.id = w.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'spraying_record', 'Penyemprotan',
    s.id, b.code, COALESCE(ch.name,'Semprot') || COALESCE(' · ' || s.target,''), NULL::numeric,
    s.sprayed_on, s.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.spraying_records s
     JOIN app.audit_log al ON al.entity_type = 'spraying_records' AND al.entity_id = s.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = s.block_id
     LEFT JOIN app.agri_input_chemicals ch ON ch.id = s.chemical_id
     LEFT JOIN app.users cu ON cu.id = s.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id
UNION ALL
  SELECT 'harvest_record', 'Panen',
    h.id, b.code, (h.quantity_ton::text || ' ton') || COALESCE(' · Grade ' || h.grade,''), NULL::numeric,
    h.harvested_on, h.approval_status,
    al.diff->'after'->>'approval_status', al.diff->'after'->>'rejection_reason',
    du.full_name, al.occurred_at, cu.full_name
   FROM app.harvest_records h
     JOIN app.audit_log al ON al.entity_type = 'harvest_records' AND al.entity_id = h.id
       AND al.action = 'update' AND al.diff->'after'->>'approval_status' IN ('approved','rejected')
     JOIN app.blocks b ON b.id = h.block_id
     LEFT JOIN app.users cu ON cu.id = h.created_by
     LEFT JOIN app.users du ON du.id = al.actor_id;

-- CREATE VIEW default-nya sudah security_invoker=false di Postgres < 15 gaya
-- lama; proyek ini eksplisit menyalakannya di setiap view baru (regresi
-- nyata: migrasi 0035 memperbaiki 0034 yang lupa melakukan ini).
ALTER VIEW app.v_approval_history SET (security_invoker = true);

GRANT SELECT ON app.v_approval_history TO app_rw, app_ro;

COMMENT ON VIEW app.v_approval_history IS
  'B-22: riwayat keputusan approval (approved/rejected), dibaca dari app.audit_log '
  '-- bukan tabel tersendiri. security_invoker=true: creator otomatis hanya melihat '
  'riwayat miliknya sendiri lewat RESTRICTIVE SELECT policy per-creator (migrasi 0054) '
  'pada tabel modul yang di-JOIN; approver/super_admin/viewer melihat seluruh tenant.';

-- Gagalkan migrasi bila cakupan RLS/audit/creator-scope bocor (sejajar 0053/0054).
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM app.check_rls_coverage();
  IF n > 0 THEN
    RAISE EXCEPTION 'check_rls_coverage() mengembalikan % baris setelah 0056', n;
  END IF;
END $$;
