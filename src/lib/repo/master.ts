import { rlsQuery, withRls, type RlsContext } from "@/lib/db";

/**
 * Akses master data.
 *
 * Semua isi dropdown di aplikasi berasal dari sini — bukan dari array di kode.
 * `constants.ts` yang berisi opsi hardcoded TIDAK dihitung dinamis
 * (docs/00-refinement-concept.md:34).
 */

export type MasterType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isHierarchical: boolean;
  isSystem: boolean;
  itemCount: number;
};

export type MasterItem = {
  id: string;
  masterTypeId: string;
  masterTypeCode: string;
  companyId: string | null;
  parentId: string | null;
  parentName: string | null;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export async function listMasterTypes(ctx: RlsContext): Promise<MasterType[]> {
  const rows = await rlsQuery<{
    id: string; code: string; name: string; description: string | null;
    is_hierarchical: boolean; is_system: boolean; item_count: string;
  }>(
    ctx,
    `SELECT mt.id, mt.code, mt.name, mt.description, mt.is_hierarchical, mt.is_system,
            COUNT(mi.id) FILTER (WHERE mi.is_active) AS item_count
       FROM app.master_types mt
       LEFT JOIN app.master_items mi ON mi.master_type_id = mt.id
      GROUP BY mt.id
      ORDER BY mt.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isHierarchical: r.is_hierarchical,
    isSystem: r.is_system,
    itemCount: Number(r.item_count),
  }));
}

export async function listMasterItems(ctx: RlsContext, typeCode: string): Promise<MasterItem[]> {
  const rows = await rlsQuery<{
    id: string; master_type_id: string; master_type_code: string; company_id: string | null;
    parent_id: string | null; parent_name: string | null; code: string; name: string;
    sort_order: number; is_active: boolean;
  }>(
    ctx,
    `SELECT mi.id, mi.master_type_id, mt.code AS master_type_code, mi.company_id,
            mi.parent_id, p.name AS parent_name, mi.code, mi.name, mi.sort_order, mi.is_active
       FROM app.master_items mi
       JOIN app.master_types mt ON mt.id = mi.master_type_id
       LEFT JOIN app.master_items p ON p.id = mi.parent_id
      WHERE mt.code = $1
      ORDER BY mi.sort_order, mi.name`,
    [typeCode],
  );
  return rows.map((r) => ({
    id: r.id,
    masterTypeId: r.master_type_id,
    masterTypeCode: r.master_type_code,
    companyId: r.company_id,
    parentId: r.parent_id,
    parentName: r.parent_name,
    code: r.code,
    name: r.name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));
}

/**
 * Opsi dropdown. Dipakai setiap form.
 *
 * Menerima kode tipe master, mengembalikan opsi aktif. Karena bacaannya dari
 * database, penambahan opsi oleh super_admin langsung tampil di seluruh form
 * tanpa redeploy — inilah acceptance test 1.
 */
export type Option = { value: string; label: string; parentId: string | null };

export async function listOptions(ctx: RlsContext, typeCode: string): Promise<Option[]> {
  const rows = await rlsQuery<{ id: string; name: string; parent_id: string | null }>(
    ctx,
    `SELECT mi.id, mi.name, mi.parent_id
       FROM app.master_items mi
       JOIN app.master_types mt ON mt.id = mi.master_type_id
      WHERE mt.code = $1 AND mi.is_active
      ORDER BY mi.sort_order, mi.name`,
    [typeCode],
  );
  return rows.map((r) => ({ value: r.id, label: r.name, parentId: r.parent_id }));
}

export async function createMasterItem(
  ctx: RlsContext,
  input: {
    masterTypeCode: string;
    code: string;
    name: string;
    parentId?: string | null;
    sortOrder?: number;
    /** null = baris global (hanya super_admin). Default: entitas aktif. */
    companyId?: string | null;
  },
): Promise<string> {
  return withRls(ctx, async (client) => {
    const type = await client.query<{ id: string }>(
      `SELECT id FROM app.master_types WHERE code = $1`,
      [input.masterTypeCode],
    );
    if (type.rowCount === 0) throw new Error(`Tipe master "${input.masterTypeCode}" tidak ditemukan`);

    const res = await client.query<{ id: string }>(
      `INSERT INTO app.master_items
         (master_type_id, company_id, parent_id, code, name, sort_order, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING id`,
      [
        type.rows[0].id,
        input.companyId === undefined ? ctx.companyId : input.companyId,
        input.parentId ?? null,
        input.code,
        input.name,
        input.sortOrder ?? 0,
        ctx.userId,
      ],
    );
    return res.rows[0].id;
  });
}

export async function updateMasterItem(
  ctx: RlsContext,
  id: string,
  input: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<void> {
  await rlsQuery(
    ctx,
    `UPDATE app.master_items
        SET name       = COALESCE($2, name),
            sort_order = COALESCE($3, sort_order),
            is_active  = COALESCE($4, is_active),
            updated_at = now(),
            updated_by = $5
      WHERE id = $1`,
    [id, input.name ?? null, input.sortOrder ?? null, input.isActive ?? null, ctx.userId],
  );
}

/** Nonaktifkan, jangan hapus — baris master mungkin sudah dirujuk transaksi. */
export async function deactivateMasterItem(ctx: RlsContext, id: string): Promise<void> {
  await updateMasterItem(ctx, id, { isActive: false });
}

// ---------------------------------------------------------------------------
// Jenis pupuk — tabel sendiri karena atributnya tidak seragam (N-P-K, jenis)
// ---------------------------------------------------------------------------

export type FertilizerType = {
  id: string;
  code: string;
  name: string;
  kind: string;
  nPct: number | null;
  p2o5Pct: number | null;
  k2oPct: number | null;
  isActive: boolean;
};

export async function listFertilizerTypes(ctx: RlsContext): Promise<FertilizerType[]> {
  const rows = await rlsQuery<{
    id: string; code: string; name: string; kind: string;
    n_pct: string | null; p2o5_pct: string | null; k2o_pct: string | null; is_active: boolean;
  }>(
    ctx,
    `SELECT id, code, name, kind, n_pct, p2o5_pct, k2o_pct, is_active
       FROM app.fertilizer_types ORDER BY name`,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    nPct: r.n_pct === null ? null : Number(r.n_pct),
    p2o5Pct: r.p2o5_pct === null ? null : Number(r.p2o5_pct),
    k2oPct: r.k2o_pct === null ? null : Number(r.k2o_pct),
    isActive: r.is_active,
  }));
}

export async function createFertilizerType(
  ctx: RlsContext,
  input: {
    code: string; name: string; kind: "single" | "compound" | "organic";
    nPct?: number | null; p2o5Pct?: number | null; k2oPct?: number | null;
  },
): Promise<string> {
  const rows = await rlsQuery<{ id: string }>(
    ctx,
    `INSERT INTO app.fertilizer_types (company_id, code, name, kind, n_pct, p2o5_pct, k2o_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      ctx.companyId,
      input.code,
      input.name,
      input.kind,
      input.nPct ?? null,
      input.p2o5Pct ?? null,
      input.k2oPct ?? null,
    ],
  );
  return rows[0].id;
}

/**
 * Opsi kategori biaya berjenjang.
 *
 * Hanya DAUN yang bisa dipilih — transaksi selalu dicatat pada sub-komponen
 * paling spesifik, sedangkan anggaran disusun pada level induk. Label memuat
 * jalur lengkap ("Tenaga Kerja › Upah Harian") supaya satu <select> cukup:
 * tanpa dropdown bertingkat yang butuh JavaScript.
 *
 * Kategori tanpa anak tetap bisa dipilih — hierarki tidak dipaksakan.
 */
export async function listCategoryOptions(ctx: RlsContext): Promise<Option[]> {
  const rows = await rlsQuery<{ id: string; label: string; parent_id: string | null }>(
    ctx,
    `SELECT mi.id,
            CASE WHEN p.id IS NULL THEN mi.name ELSE p.name || ' › ' || mi.name END AS label,
            mi.parent_id
       FROM app.master_items mi
       JOIN app.master_types mt ON mt.id = mi.master_type_id
       LEFT JOIN app.master_items p ON p.id = mi.parent_id
      WHERE mt.code = 'cost_category' AND mi.is_active
        -- daun saja: kategori induk yang punya anak tidak bisa dipilih langsung
        AND NOT EXISTS (SELECT 1 FROM app.master_items ch
                         WHERE ch.parent_id = mi.id AND ch.is_active)
      ORDER BY COALESCE(p.sort_order, mi.sort_order), p.name NULLS FIRST, mi.sort_order, mi.name`,
  );
  return rows.map((r) => ({ value: r.id, label: r.label, parentId: r.parent_id }));
}

/** Kategori INDUK saja — untuk penyusunan anggaran. */
export async function listParentCategoryOptions(ctx: RlsContext): Promise<Option[]> {
  const rows = await rlsQuery<{ id: string; name: string }>(
    ctx,
    `SELECT mi.id, mi.name
       FROM app.master_items mi
       JOIN app.master_types mt ON mt.id = mi.master_type_id
      WHERE mt.code = 'cost_category' AND mi.is_active AND mi.parent_id IS NULL
      ORDER BY mi.sort_order, mi.name`,
  );
  return rows.map((r) => ({ value: r.id, label: r.name, parentId: null }));
}

// ---------------------------------------------------------------------------
// Pengguna & akses (untuk layar super_admin)
// ---------------------------------------------------------------------------

export type AppUser = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  estateCount: number;
};

export async function listUsers(ctx: RlsContext): Promise<AppUser[]> {
  const rows = await rlsQuery<{
    id: string; full_name: string; email: string; app_role: string;
    is_active: boolean; estate_count: string;
  }>(
    ctx,
    `SELECT u.id, u.full_name, u.email::text, u.app_role, u.is_active,
            (SELECT count(*) FROM app.user_estate_access uea WHERE uea.user_id = u.id) AS estate_count
       FROM app.users u
      ORDER BY u.full_name`,
  );
  return rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.app_role,
    isActive: r.is_active,
    estateCount: Number(r.estate_count),
  }));
}

/**
 * AI-28 · satu baris pengguna, untuk pemeriksaan sebelum mengubah statusnya.
 * Dipakai action supaya pesannya bisa spesifik (diri sendiri / super_admin
 * terakhir) alih-alih memantulkan galat trigger mentah.
 */
export async function getUserRow(
  ctx: RlsContext,
  id: string,
): Promise<{ id: string; fullName: string; appRole: string; isActive: boolean } | null> {
  const rows = await rlsQuery<{ id: string; full_name: string; app_role: string; is_active: boolean }>(
    ctx,
    `SELECT id, full_name, app_role, is_active FROM app.users WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  return r ? { id: r.id, fullName: r.full_name, appRole: r.app_role, isActive: r.is_active } : null;
}

/** AI-28 · nonaktifkan / aktifkan kembali. Trigger 0052 yang menjaga invariannya. */
export async function setUserActive(ctx: RlsContext, id: string, active: boolean): Promise<void> {
  await rlsQuery(ctx, `UPDATE app.users SET is_active = $2 WHERE id = $1`, [id, active]);
}

/**
 * AI-28 · hapus keras.
 *
 * Hanya berhasil untuk pengguna yang belum pernah membuat apa pun: 59 dari 61
 * foreign key ke app.users memakai NO ACTION, jadi database menolak menghapus
 * siapa pun yang meninggalkan jejak. Itu memang yang diinginkan -- menghapusnya
 * akan menghilangkan "siapa yang melakukan ini" dari riwayat. Galat 23503
 * diterjemahkan di lapisan action menjadi saran "nonaktifkan saja".
 */
export async function deleteUser(ctx: RlsContext, id: string): Promise<void> {
  await rlsQuery(ctx, `DELETE FROM app.users WHERE id = $1`, [id]);
}
