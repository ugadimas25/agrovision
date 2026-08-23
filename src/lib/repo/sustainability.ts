import { rlsQuery, type RlsContext } from "@/lib/db";
import { toDateString } from "@/lib/date";

/**
 * Modul keberlanjutan: karbon, sertifikasi, traceability.
 *
 * Angka karbon dihitung di database (fungsi app.generate_carbon_run) dari luas
 * blok + pengukuran DBH + faktor referensi IPCC perkiraan. Koefisiennya bertanda
 * requires_validation; UI wajib menampilkan peringatan itu.
 */

// --- KARBON ---

export type CarbonRun = {
  code: string;
  periodStart: string;
  periodEnd: string;
  grossEmissionTco2e: number | null;
  sequestrationTco2e: number | null;
  netBalanceTco2e: number | null;
  status: string;
  dataCompletenessPct: number | null;
};

export type CarbonBlock = {
  blockCode: string;
  areaHa: number | null;
  emissionTco2e: number | null;
  sequestrationTco2e: number | null;
  netTco2e: number | null;
  status: string;
};

export type EmissionFactor = {
  code: string;
  name: string;
  value: number;
  unitNumerator: string;
  unitDenominator: string;
  sourceStandard: string;
  requiresNote: boolean;
};

export async function latestCarbonRun(ctx: RlsContext): Promise<CarbonRun | null> {
  const rows = await rlsQuery<{
    code: string; period_start: string; period_end: string;
    gross_emission_tco2e: string | null; sequestration_tco2e: string | null;
    net_balance_tco2e: string | null; status: string; data_completeness_pct: string | null;
  }>(
    ctx,
    `SELECT code, period_start, period_end, gross_emission_tco2e, sequestration_tco2e,
            net_balance_tco2e, status, data_completeness_pct
       FROM app.carbon_runs ORDER BY period_end DESC LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    code: r.code,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    grossEmissionTco2e: r.gross_emission_tco2e === null ? null : Number(r.gross_emission_tco2e),
    sequestrationTco2e: r.sequestration_tco2e === null ? null : Number(r.sequestration_tco2e),
    netBalanceTco2e: r.net_balance_tco2e === null ? null : Number(r.net_balance_tco2e),
    status: r.status,
    dataCompletenessPct: r.data_completeness_pct === null ? null : Number(r.data_completeness_pct),
  };
}

export async function carbonByBlock(ctx: RlsContext): Promise<CarbonBlock[]> {
  const rows = await rlsQuery<{
    block_code: string; area_ha: string | null; emission_tco2e: string | null;
    sequestration_tco2e: string | null; net_tco2e: string | null; status: string;
  }>(
    ctx,
    `SELECT b.code AS block_code, crb.area_ha_snapshot AS area_ha, crb.emission_tco2e,
            crb.sequestration_tco2e, crb.net_tco2e, crb.status
       FROM app.carbon_run_blocks crb
       JOIN app.blocks b ON b.id = crb.block_id
       JOIN app.carbon_runs cr ON cr.id = crb.run_id
      WHERE cr.id = (SELECT id FROM app.carbon_runs ORDER BY period_end DESC LIMIT 1)
      ORDER BY crb.net_tco2e ASC`,
  );
  return rows.map((r) => ({
    blockCode: r.block_code,
    areaHa: r.area_ha === null ? null : Number(r.area_ha),
    emissionTco2e: r.emission_tco2e === null ? null : Number(r.emission_tco2e),
    sequestrationTco2e: r.sequestration_tco2e === null ? null : Number(r.sequestration_tco2e),
    netTco2e: r.net_tco2e === null ? null : Number(r.net_tco2e),
    status: r.status,
  }));
}

export async function listEmissionFactors(ctx: RlsContext): Promise<EmissionFactor[]> {
  const rows = await rlsQuery<{
    code: string; name: string; value: string; unit_numerator: string;
    unit_denominator: string; source_standard: string;
  }>(
    ctx,
    `SELECT code, name, value, unit_numerator, unit_denominator, source_standard
       FROM app.emission_factors WHERE valid_to IS NULL ORDER BY code`,
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    value: Number(r.value),
    unitNumerator: r.unit_numerator,
    unitDenominator: r.unit_denominator,
    sourceStandard: r.source_standard,
    requiresNote: /perkiraan|perlu validasi/i.test(r.source_standard),
  }));
}

/** Ada koefisien yang belum divalidasi? UI memakai ini untuk memasang peringatan. */
export async function carbonNeedsValidation(ctx: RlsContext): Promise<boolean> {
  const rows = await rlsQuery<{ n: string }>(
    ctx,
    `SELECT count(*) AS n FROM app.allometric_coefficients WHERE requires_validation`,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

// --- SERTIFIKASI ---

export type CertProgram = {
  code: string;
  name: string;
  standardName: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  blockCount: number;
  avgReadiness: number | null;
};

export type CertAssessment = {
  code: string;
  blockCode: string;
  status: string;
  scorePct: number | null;
  hasCriticalFailure: boolean;
  findingCount: number;
};

export type Certificate = {
  code: string;
  blockCode: string;
  standardName: string;
  validFrom: string;
  validUntil: string;
  daysLeft: number;
  state: "active" | "expiring" | "expired" | "revoked";
};

export type CapaItem = {
  code: string;
  blockCode: string;
  severity: string;
  description: string;
  status: string;
  dueDate: string;
};

export async function listCertPrograms(ctx: RlsContext): Promise<CertProgram[]> {
  const rows = await rlsQuery<{
    code: string; name: string; standard_name: string; period_start: string;
    period_end: string; status: string; block_count: string; avg_readiness: string | null;
  }>(
    ctx,
    `SELECT p.code, p.name, s.name AS standard_name, p.period_start, p.period_end, p.status,
            count(pb.block_id) AS block_count, round(avg(pb.readiness_pct), 1) AS avg_readiness
       FROM app.cert_programs p
       JOIN app.standard_versions sv ON sv.id = p.standard_version_id
       JOIN app.standards s ON s.id = sv.standard_id
       LEFT JOIN app.cert_program_blocks pb ON pb.program_id = p.id
      GROUP BY p.id, s.name
      ORDER BY p.period_start DESC`,
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    standardName: r.standard_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    blockCount: Number(r.block_count),
    avgReadiness: r.avg_readiness === null ? null : Number(r.avg_readiness),
  }));
}

export async function listCertAssessments(ctx: RlsContext): Promise<CertAssessment[]> {
  const rows = await rlsQuery<{
    code: string; block_code: string; status: string; score_pct: string | null;
    has_critical_failure: boolean; finding_count: string;
  }>(
    ctx,
    `SELECT a.code, b.code AS block_code, a.status, a.score_pct, a.has_critical_failure,
            (SELECT count(*) FROM app.cert_findings f WHERE f.assessment_id = a.id) AS finding_count
       FROM app.cert_assessments a
       JOIN app.blocks b ON b.id = a.block_id
      ORDER BY a.code`,
  );
  return rows.map((r) => ({
    code: r.code,
    blockCode: r.block_code,
    status: r.status,
    scorePct: r.score_pct === null ? null : Number(r.score_pct),
    hasCriticalFailure: r.has_critical_failure,
    findingCount: Number(r.finding_count),
  }));
}

export async function listCertificates(ctx: RlsContext): Promise<Certificate[]> {
  const rows = await rlsQuery<{
    code: string; block_code: string; standard_name: string; valid_from: string;
    valid_until: string; days_left: string; revoked: boolean;
  }>(
    ctx,
    `SELECT ct.code, b.code AS block_code, s.name AS standard_name, ct.valid_from, ct.valid_until,
            (ct.valid_until - current_date) AS days_left, (ct.revoked_at IS NOT NULL) AS revoked
       FROM app.certificates ct
       JOIN app.blocks b ON b.id = ct.block_id
       JOIN app.standard_versions sv ON sv.id = ct.standard_version_id
       JOIN app.standards s ON s.id = sv.standard_id
      ORDER BY ct.valid_until`,
  );
  return rows.map((r) => {
    const daysLeft = Number(r.days_left);
    const state: Certificate["state"] = r.revoked
      ? "revoked"
      : daysLeft < 0
        ? "expired"
        : daysLeft <= 90
          ? "expiring"
          : "active";
    return {
      code: r.code,
      blockCode: r.block_code,
      standardName: r.standard_name,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      daysLeft,
      state,
    };
  });
}

export async function listCapa(ctx: RlsContext): Promise<CapaItem[]> {
  const rows = await rlsQuery<{
    code: string; block_code: string; severity: string; description: string;
    status: string; due_date: string;
  }>(
    ctx,
    `SELECT c.code, b.code AS block_code, f.severity, f.description, c.status, c.due_date
       FROM app.capa c
       JOIN app.blocks b ON b.id = c.block_id
       JOIN app.cert_findings f ON f.id = c.finding_id
      ORDER BY c.due_date`,
  );
  return rows.map((r) => ({
    code: r.code,
    blockCode: r.block_code,
    severity: r.severity,
    description: r.description,
    status: r.status,
    dueDate: r.due_date,
  }));
}

// --- TRACEABILITY ---
// Belum ada panen. Rantai yang ada: batch bibit → distribusi → blok.

export type TraceBatch = {
  batchCode: string;
  cropName: string;
  variety: string | null;
  supplierName: string | null;
  qtyInitial: number;
  distributions: { blockCode: string; qty: number; distributedOn: string }[];
};

export async function traceSeedBatches(ctx: RlsContext): Promise<TraceBatch[]> {
  const rows = await rlsQuery<{
    batch_code: string; crop_name: string; variety: string | null; supplier_name: string | null;
    qty_initial: number; block_code: string | null; qty: number | null; distributed_on: string | null;
  }>(
    ctx,
    `SELECT sb.code AS batch_code, c.name AS crop_name, sb.variety, sup.name AS supplier_name,
            sb.qty_initial, b.code AS block_code, sd.qty, sd.distributed_on
       FROM app.seed_batches sb
       JOIN app.crops c ON c.id = sb.crop_id
       LEFT JOIN app.suppliers sup ON sup.id = sb.supplier_id
       LEFT JOIN app.seed_distributions sd ON sd.seed_batch_id = sb.id
       LEFT JOIN app.blocks b ON b.id = sd.block_id
      WHERE sb.archived_at IS NULL
      ORDER BY sb.code, b.code`,
  );
  const map = new Map<string, TraceBatch>();
  for (const r of rows) {
    const t = map.get(r.batch_code) ?? {
      batchCode: r.batch_code,
      cropName: r.crop_name,
      variety: r.variety,
      supplierName: r.supplier_name,
      qtyInitial: Number(r.qty_initial),
      distributions: [],
    };
    if (r.block_code && r.qty !== null) {
      t.distributions.push({
        blockCode: r.block_code,
        qty: Number(r.qty),
        distributedOn: r.distributed_on ?? "",
      });
    }
    map.set(r.batch_code, t);
  }
  return [...map.values()];
}

// --- REGISTRI KEPATUHAN (perizinan & sertifikasi, docs/08) ---

export type ComplianceItem = {
  groupCode: string;
  groupLabel: string;
  code: string;
  name: string;
  issuer: string | null;
  appliesCoconut: boolean;
  appliesDurian: boolean;
  validityNote: string | null;
  isPrerequisite: boolean;
  status: string;
  referenceNo: string | null;
  note: string | null;
  obtainedOn: string | null;
  expiresOn: string | null;
};

export type ComplianceGroup = {
  code: string;
  label: string;
  items: ComplianceItem[];
  total: number;
  issued: number;
};

/** Seluruh item + status entitas aktif, dikelompokkan per grup A–H. */
export async function complianceRegistry(ctx: RlsContext): Promise<ComplianceGroup[]> {
  const rows = await rlsQuery<{
    group_code: string; group_label: string; code: string; name: string; issuer: string | null;
    applies_coconut: boolean; applies_durian: boolean; validity_note: string | null;
    is_prerequisite: boolean; status: string | null; reference_no: string | null;
    note: string | null; obtained_on: string | null; expires_on: string | null;
  }>(
    ctx,
    `SELECT i.group_code, i.group_label, i.code, i.name, i.issuer,
            i.applies_coconut, i.applies_durian, i.validity_note, i.is_prerequisite,
            t.status::text, t.reference_no, t.note, t.obtained_on, t.expires_on
       FROM app.compliance_items i
       LEFT JOIN app.compliance_tracking t
         ON t.item_code = i.code AND app.company_in_scope(t.company_id)
      ORDER BY i.sort_order`,
  );

  const groups = new Map<string, ComplianceGroup>();
  for (const r of rows) {
    const g = groups.get(r.group_code) ??
      { code: r.group_code, label: r.group_label, items: [], total: 0, issued: 0 };
    const status = r.status ?? "belum_mulai";
    g.items.push({
      groupCode: r.group_code,
      groupLabel: r.group_label,
      code: r.code,
      name: r.name,
      issuer: r.issuer,
      appliesCoconut: r.applies_coconut,
      appliesDurian: r.applies_durian,
      validityNote: r.validity_note,
      isPrerequisite: r.is_prerequisite,
      status,
      referenceNo: r.reference_no,
      note: r.note,
      // toDateString, BUKAN toISOString: nilai ini dipakai sebagai defaultValue
      // <input type="date"> di RegistryGroup.tsx lalu dikirim balik ke DB lewat
      // setComplianceStatus(). toISOString() menggesernya satu hari ke belakang
      // di WIB, jadi tanggalnya MUNDUR tiap kali approver menekan Simpan --
      // walau ia hanya mengubah catatan. Itu kerusakan data, bukan label.
      obtainedOn: toDateString(r.obtained_on),
      expiresOn: toDateString(r.expires_on),
    });
    g.total += 1;
    if (status === "terbit" || status === "akan_berakhir") g.issued += 1;
    groups.set(r.group_code, g);
  }
  return [...groups.values()];
}

/** Set/perbarui status kepatuhan satu item. Idempoten (upsert). */
export async function setComplianceStatus(
  ctx: RlsContext,
  input: { itemCode: string; status: string; referenceNo?: string | null; note?: string | null; obtainedOn?: string | null; expiresOn?: string | null },
): Promise<void> {
  await rlsQuery(
    ctx,
    `INSERT INTO app.compliance_tracking
       (company_id, item_code, status, reference_no, note, obtained_on, expires_on, updated_by)
     VALUES ($1,$2,$3::app.compliance_status,$4,$5,$6,$7,$8)
     ON CONFLICT (company_id, item_code) DO UPDATE SET
       status = EXCLUDED.status, reference_no = EXCLUDED.reference_no, note = EXCLUDED.note,
       obtained_on = EXCLUDED.obtained_on, expires_on = EXCLUDED.expires_on,
       updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [ctx.companyId, input.itemCode, input.status, input.referenceNo ?? null,
     input.note ?? null, input.obtainedOn || null, input.expiresOn || null, ctx.userId],
  );
}

// --- SERTIFIKASI ORGANIK (docs/10) ---

export type OrganicItem = {
  kind: "standard" | "evidence";
  code: string;
  name: string;
  market: string | null;
  detail: string | null;
  issuer: string | null;
  appliesCoconut: boolean;
  appliesDurian: boolean;
  isPrerequisite: boolean;
  status: string;
  referenceNo: string | null;
  note: string | null;
  obtainedOn: string | null;
  expiresOn: string | null;
};

export type OrganicRegistry = {
  standards: OrganicItem[];
  evidence: OrganicItem[];
  evidenceDone: number;
  evidenceTotal: number;
  certifiedCount: number;
};

/** Seluruh item organik + status entitas aktif, dipisah standar & bukti. */
export async function organicRegistry(ctx: RlsContext): Promise<OrganicRegistry> {
  const rows = await rlsQuery<{
    kind: "standard" | "evidence"; code: string; name: string; market: string | null;
    detail: string | null; issuer: string | null; applies_coconut: boolean; applies_durian: boolean;
    is_prerequisite: boolean; status: string | null; reference_no: string | null;
    note: string | null; obtained_on: string | null; expires_on: string | null;
  }>(
    ctx,
    `SELECT i.kind, i.code, i.name, i.market, i.detail, i.issuer,
            i.applies_coconut, i.applies_durian, i.is_prerequisite,
            t.status::text, t.reference_no, t.note, t.obtained_on, t.expires_on
       FROM app.organic_items i
       LEFT JOIN app.organic_tracking t
         ON t.item_code = i.code AND app.company_in_scope(t.company_id)
      ORDER BY i.sort_order`,
  );
  const map = (r: (typeof rows)[number]): OrganicItem => ({
    kind: r.kind,
    code: r.code,
    name: r.name,
    market: r.market,
    detail: r.detail,
    issuer: r.issuer,
    appliesCoconut: r.applies_coconut,
    appliesDurian: r.applies_durian,
    isPrerequisite: r.is_prerequisite,
    status: r.status ?? "belum_mulai",
    referenceNo: r.reference_no,
    note: r.note,
    // Sama seperti complianceRegistry: nilai ini dikirim balik ke DB lewat
    // OrganicTracker.tsx -> setOrganicStatus(), jadi pergeseran zona waktu di
    // sini merusak DATA, bukan hanya tampilan.
    obtainedOn: toDateString(r.obtained_on),
    expiresOn: toDateString(r.expires_on),
  });
  const standards = rows.filter((r) => r.kind === "standard").map(map);
  const evidence = rows.filter((r) => r.kind === "evidence").map(map);
  return {
    standards,
    evidence,
    evidenceDone: evidence.filter((e) => e.status === "tersertifikasi").length,
    evidenceTotal: evidence.length,
    certifiedCount: standards.filter((s) => s.status === "tersertifikasi").length,
  };
}

/** Set/perbarui status organik satu item. Idempoten (upsert). */
export async function setOrganicStatus(
  ctx: RlsContext,
  input: { itemCode: string; status: string; referenceNo?: string | null; note?: string | null; obtainedOn?: string | null; expiresOn?: string | null },
): Promise<void> {
  await rlsQuery(
    ctx,
    `INSERT INTO app.organic_tracking
       (company_id, item_code, status, reference_no, note, obtained_on, expires_on, updated_by)
     VALUES ($1,$2,$3::app.organic_status,$4,$5,$6,$7,$8)
     ON CONFLICT (company_id, item_code) DO UPDATE SET
       status = EXCLUDED.status, reference_no = EXCLUDED.reference_no, note = EXCLUDED.note,
       obtained_on = EXCLUDED.obtained_on, expires_on = EXCLUDED.expires_on,
       updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [ctx.companyId, input.itemCode, input.status, input.referenceNo ?? null,
     input.note ?? null, input.obtainedOn || null, input.expiresOn || null, ctx.userId],
  );
}
