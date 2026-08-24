"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createFertilizerApplication,
  createLandPreparation,
  createLandSuitability,
  createNurseryInspection,
  createSeedDistribution,
  createDbhMeasurement,
  createPruningRecord,
  createWeedingRecord,
  createSprayingRecord,
  createHarvestRecord,
  submitOpRecord,
} from "@/lib/repo/operational";

export type ActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function toMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === "UNAUTHENTICATED") return "Sesi berakhir. Silakan masuk kembali.";
  if (raw === "FORBIDDEN") return "Peran Anda tidak berhak melakukan ini.";
  if (/lsa_one_per_block/.test(raw)) {
    return "Blok ini sudah punya assessment kesesuaian lahan. Satu blok hanya boleh satu.";
  }
  if (/row-level security/.test(raw)) return "Anda tidak berhak menulis data ini, atau blok di luar akses Anda.";
  return raw;
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal wajib diisi");
const posNum = z.coerce.number().min(0, "Tidak boleh negatif");
const uuid = z.string().uuid("Pilihan tidak valid");
const optNum = z.union([z.coerce.number().min(0), z.literal("")]).optional();
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

async function run(
  role: string[],
  paths: string[],
  fn: () => Promise<void>,
): Promise<ActionState> {
  await fn();
  for (const p of paths) revalidatePath(p);
  return { ok: true, message: "Tersimpan sebagai draft. Ajukan agar masuk approval." };
}

// --- Pemupukan ---
const fertSchema = z.object({
  blockId: uuid,
  fertilizerTypeId: uuid,
  cropCode: z.union([z.enum(["DURIAN", "COCONUT"]), z.literal("")]).optional(),
  growthPhase: z.enum(["seedling", "vegetative", "productive"]),
  appliedOn: dateStr,
  totalQuantity: posNum.refine((v) => v > 0, "Jumlah harus lebih dari 0"),
  uomItemId: z.union([uuid, z.literal("")]).optional(),
  treeCount: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createFertilizerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = fertSchema.safeParse({
      blockId: fd.get("blockId"), fertilizerTypeId: fd.get("fertilizerTypeId"),
      cropCode: fd.get("cropCode") ?? "",
      growthPhase: fd.get("growthPhase"), appliedOn: fd.get("appliedOn"),
      totalQuantity: fd.get("totalQuantity"), uomItemId: fd.get("uomItemId") ?? "",
      treeCount: fd.get("treeCount") || "", note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/operasional/pemupukan", "/approval"], () =>
      createFertilizerApplication(ctx, {
        blockId: parsed.data.blockId, fertilizerTypeId: parsed.data.fertilizerTypeId,
        cropCode: parsed.data.cropCode || null,
        growthPhase: parsed.data.growthPhase, appliedOn: parsed.data.appliedOn,
        totalQuantity: parsed.data.totalQuantity,
        uomItemId: parsed.data.uomItemId || null,
        treeCount: typeof parsed.data.treeCount === "number" ? parsed.data.treeCount : null,
        note: parsed.data.note || null,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Persiapan Lahan ---
const prepSchema = z.object({
  blockId: uuid,
  checkedAt: dateStr,
  soilPh: z.union([z.coerce.number().min(0).max(14), z.literal("")]).optional(),
  holeCount: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  effectiveAreaHa: z.union([posNum, z.literal("")]).optional(),
  status: z.enum(["not_started", "in_progress", "ready_to_plant"]),
  note: z.string().trim().max(500).optional(),
  // Layout tanam dari Master Data (tipe planting_layout, migrasi 0050). Opsional:
  // sebelum ini laporan MENGARANG '3 m × 3 m' untuk setiap baris; kosong yang
  // jujur lebih baik daripada spesifikasi agronomi yang tidak pernah diukur.
  plantingLayoutItemId: z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : null)),
})
  // Wajib HANYA bila pekerjaannya sudah berjalan. Status "belum mulai" memang
  // belum punya luas efektif, dan memaksa angka di situ justru memancing tebakan
  // -- lebih buruk daripada kolom kosong.
  .refine(
    (d) => d.status === "not_started" || (typeof d.effectiveAreaHa === "number" && d.effectiveAreaHa > 0),
    {
      message: "Area efektif wajib diisi bila pekerjaan sudah berjalan — tanpa itu biaya persiapan lahan tidak bisa dihitung",
      path: ["effectiveAreaHa"],
    },
  );

export async function createLandPrepAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = prepSchema.safeParse({
      blockId: fd.get("blockId"), checkedAt: fd.get("checkedAt"),
      soilPh: fd.get("soilPh") || "", holeCount: fd.get("holeCount") || "",
      effectiveAreaHa: fd.get("effectiveAreaHa") || "", status: fd.get("status"),
      note: fd.get("note") ?? "",
      plantingLayoutItemId: fd.get("plantingLayoutItemId") ?? undefined,
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/operasional/persiapan-lahan", "/approval"], () =>
      createLandPreparation(ctx, {
        blockId: parsed.data.blockId, checkedAt: parsed.data.checkedAt,
        soilPh: typeof parsed.data.soilPh === "number" ? parsed.data.soilPh : null,
        holeCount: typeof parsed.data.holeCount === "number" ? parsed.data.holeCount : null,
        effectiveAreaHa: typeof parsed.data.effectiveAreaHa === "number" ? parsed.data.effectiveAreaHa : null,
        status: parsed.data.status, note: parsed.data.note || null,
        plantingLayoutItemId: parsed.data.plantingLayoutItemId,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Kesesuaian Lahan ---
const suitSchema = z.object({
  blockId: uuid,
  assessedAt: dateStr,
  slopePct: z.union([posNum, z.literal("")]).optional(),
  elevationM: z.union([posNum, z.literal("")]).optional(),
  rainfallMmYear: z.union([posNum, z.literal("")]).optional(),
  scoreDurian: z.union([z.coerce.number().min(0).max(100), z.literal("")]).optional(),
  scoreCoconut: z.union([z.coerce.number().min(0).max(100), z.literal("")]).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createLandSuitabilityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const num = (k: string) => { const v = fd.get(k); return v ? v : ""; };
    const parsed = suitSchema.safeParse({
      blockId: fd.get("blockId"), assessedAt: fd.get("assessedAt"),
      slopePct: num("slopePct"), elevationM: num("elevationM"), rainfallMmYear: num("rainfallMmYear"),
      scoreDurian: num("scoreDurian"), scoreCoconut: num("scoreCoconut"), note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    const n = (v: number | "" | undefined) => (typeof v === "number" ? v : null);
    return await run(["creator"], ["/operasional/kesesuaian-lahan", "/approval"], () =>
      createLandSuitability(ctx, {
        blockId: parsed.data.blockId, assessedAt: parsed.data.assessedAt,
        slopePct: n(parsed.data.slopePct), elevationM: n(parsed.data.elevationM),
        rainfallMmYear: n(parsed.data.rainfallMmYear), scoreDurian: n(parsed.data.scoreDurian),
        scoreCoconut: n(parsed.data.scoreCoconut), note: parsed.data.note || null,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Pruning ---
// AI-03 — field volume yang MENJADI DRIVER BIAYA dijadikan wajib.
//
// Nilai refleksi tiap modul di Inbox Approval dihitung volume × tarif
// (app.v_pending_approvals, migrasi 0036): pruning memakai tree_count × PRUNE-TREE,
// penyiangan area_ha × WEED-HA, penyemprotan total_volume × SPRAY-L, persiapan
// lahan effective_area_ha × PREP-HA. Selama field itu opsional, record bisa
// tersimpan tanpa volume dan biayanya MUSTAHIL dihitung -- itulah yang dilaporkan
// penguji di B-05 dan B-07 ("tidak terdapat harga di inbox approval").
//
// Pesan galatnya menyebutkan akibatnya, bukan cuma "wajib diisi": orang yang tahu
// akibatnya akan mencari angka yang benar, bukan mengarang angka supaya form lolos.
const pruneSchema = z.object({
  blockId: uuid,
  prunedOn: dateStr,
  treeCount: z.coerce
    .number({ message: "Jumlah pohon wajib diisi" })
    .int("Jumlah pohon harus bilangan bulat")
    .refine((v) => v > 0, "Jumlah pohon harus lebih dari 0 — tanpa angka ini biaya pruning tidak bisa dihitung"),
  note: z.string().trim().max(500).optional(),
});

export async function createPruningAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = pruneSchema.safeParse({
      blockId: fd.get("blockId"), prunedOn: fd.get("prunedOn"),
      treeCount: fd.get("treeCount") || "", note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/operasional/pruning", "/approval"], () =>
      createPruningRecord(ctx, {
        blockId: parsed.data.blockId, prunedOn: parsed.data.prunedOn,
        treeCount: typeof parsed.data.treeCount === "number" ? parsed.data.treeCount : null,
        note: parsed.data.note || null,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Penyiangan (Weeding) ---
const weedSchema = z.object({
  blockId: uuid,
  weededOn: dateStr,
  method: z.enum(["manual", "mekanis", "mulsa", "herbisida", "penutup_tanah"]),
  areaHa: z.coerce
    .number({ message: "Luas wajib diisi" })
    .refine((v) => v > 0, "Luas harus lebih dari 0 — tanpa luas, biaya penyiangan tidak bisa dihitung"),
  laborCount: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createWeedingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = weedSchema.safeParse({
      blockId: fd.get("blockId"), weededOn: fd.get("weededOn"), method: fd.get("method"),
      areaHa: fd.get("areaHa") || "", laborCount: fd.get("laborCount") || "", note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/aktivitas/weeding", "/approval"], () =>
      createWeedingRecord(ctx, {
        blockId: parsed.data.blockId, weededOn: parsed.data.weededOn, method: parsed.data.method,
        areaHa: numOrNull(parsed.data.areaHa), laborCount: numOrNull(parsed.data.laborCount),
        note: parsed.data.note || null,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Penyemprotan (Spraying) ---
const spraySchema = z.object({
  blockId: uuid,
  sprayedOn: dateStr,
  chemicalId: z.union([uuid, z.literal("")]).optional(),
  target: z.string().trim().max(120).optional(),
  dosePerHa: optNum,
  totalVolume: z.coerce
    .number({ message: "Volume total wajib diisi" })
    .refine((v) => v > 0, "Volume total harus lebih dari 0 — tanpa volume, biaya penyemprotan tidak bisa dihitung"),
  unit: z.string().trim().max(20).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createSprayingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = spraySchema.safeParse({
      blockId: fd.get("blockId"), sprayedOn: fd.get("sprayedOn"), chemicalId: fd.get("chemicalId") || "",
      target: fd.get("target") ?? "", dosePerHa: fd.get("dosePerHa") || "", totalVolume: fd.get("totalVolume") || "",
      unit: fd.get("unit") ?? "", note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/aktivitas/spraying", "/approval"], () =>
      createSprayingRecord(ctx, {
        blockId: parsed.data.blockId, sprayedOn: parsed.data.sprayedOn,
        chemicalId: parsed.data.chemicalId || null, target: parsed.data.target || null,
        dosePerHa: numOrNull(parsed.data.dosePerHa), totalVolume: numOrNull(parsed.data.totalVolume),
        unit: parsed.data.unit || null, note: parsed.data.note || null,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Panen (Harvesting) ---
const harvestSchema = z.object({
  blockId: uuid,
  harvestedOn: dateStr,
  cropCode: z.enum(["DURIAN", "COCONUT"]),
  quantityTon: posNum.refine((v) => v > 0, "Tonase harus lebih dari 0"),
  grade: z.string().trim().max(40).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createHarvestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = harvestSchema.safeParse({
      blockId: fd.get("blockId"), harvestedOn: fd.get("harvestedOn"), cropCode: fd.get("cropCode"),
      quantityTon: fd.get("quantityTon"), grade: fd.get("grade") ?? "", note: fd.get("note") ?? "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/aktivitas/panen", "/approval", "/dashboard/financial", "/costing/refleksi"], () =>
      createHarvestRecord(ctx, {
        blockId: parsed.data.blockId, harvestedOn: parsed.data.harvestedOn, cropCode: parsed.data.cropCode,
        quantityTon: parsed.data.quantityTon, grade: parsed.data.grade || null, note: parsed.data.note || null,
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Inspeksi Bibit (Nursery) ---
// K-05 (diputuskan 23 Agu 2026): jenis/varietas bibit dirujuk dari Master Data.
// Form ini hanya MEMILIH batch lewat dropdown — tidak ada teks bebas dan tidak
// ada pembuatan jenis bibit inline.
//
// qtyAlive divalidasi dari string mentah, bukan z.coerce: Number("") = 0,
// padahal 0 bibit hidup adalah nilai sah — kosong dan nol harus dibedakan.
const nurseryInspSchema = z.object({
  seedBatchId: uuid,
  inspectedOn: dateStr,
  qtyAlive: z
    .string()
    .min(1, "Jumlah hidup wajib diisi — angka inilah yang menggerakkan survival rate")
    .regex(/^\d+$/, "Jumlah hidup harus bilangan bulat, nol atau lebih")
    .transform(Number),
  qtyDead: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  qtyDamaged: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
});

export async function createNurseryInspectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = nurseryInspSchema.safeParse({
      seedBatchId: fd.get("seedBatchId"), inspectedOn: fd.get("inspectedOn"),
      qtyAlive: String(fd.get("qtyAlive") ?? ""),
      qtyDead: fd.get("qtyDead") || "", qtyDamaged: fd.get("qtyDamaged") || "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    // Mati/rusak kosong = 0, BUKAN null: kolomnya NOT NULL DEFAULT 0 dan inspeksi
    // memang menghitung ketiganya — ini bukan kasus "belum ada data".
    const zeroIfEmpty = (v: number | "" | undefined) => (typeof v === "number" ? v : 0);
    return await run(["creator"], ["/nursery", "/approval"], () =>
      createNurseryInspection(ctx, {
        seedBatchId: parsed.data.seedBatchId,
        inspectedOn: parsed.data.inspectedOn,
        qtyAlive: parsed.data.qtyAlive,
        qtyDead: zeroIfEmpty(parsed.data.qtyDead),
        qtyDamaged: zeroIfEmpty(parsed.data.qtyDamaged),
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Pengukuran DBH (halaman /keberlanjutan/karbon) ---
// Form ini hanya MENCATAT hasil ukur lapangan (diameter, tinggi). Biomassa dan
// serapan karbon TIDAK dihitung di sini — itu tugas carbon run memakai koefisien
// alometrik yang masih bertanda requires_validation (koefisien sengaja kosong,
// jangan diisi dari kode).
const dbhSchema = z.object({
  blockId: uuid,
  cropId: uuid,
  measuredAt: dateStr,
  dbhCm: z.coerce
    .number({ message: "DBH wajib diisi" })
    .refine((v) => v > 0, "DBH harus lebih dari 0 cm — tanpa diameter batang, biomassa dan serapan karbon blok ini tidak bisa dihitung"),
  heightM: z
    .union([
      z.coerce.number().refine((v) => v > 0, "Tinggi harus lebih dari 0 m — kosongkan bila memang tidak diukur"),
      z.literal(""),
    ])
    .optional(),
});

export async function createDbhAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = dbhSchema.safeParse({
      blockId: fd.get("blockId"), cropId: fd.get("cropId"), measuredAt: fd.get("measuredAt"),
      dbhCm: fd.get("dbhCm") || "", heightM: fd.get("heightM") || "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    return await run(["creator"], ["/keberlanjutan/karbon", "/approval"], () =>
      createDbhMeasurement(ctx, {
        blockId: parsed.data.blockId, cropId: parsed.data.cropId, measuredAt: parsed.data.measuredAt,
        dbhCm: parsed.data.dbhCm, heightM: numOrNull(parsed.data.heightM),
      }).then(() => {}),
    );
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Distribusi bibit (AI-50) ---
// PENCATATAN LANGSUNG: seed_distributions tidak punya approval_status, jadi
// action ini tidak memakai run() (pesannya menyebut draft/approval) dan modul
// ini tidak masuk OP_MODULES. Aman meski di-POST langsung: requireRole menolak
// viewer, dan policy seed_distributions_viewer_readonly (migrasi 0042) menolak
// di lapis database.
const seedDistSchema = z.object({
  seedBatchId: uuid,
  blockId: uuid,
  distributedOn: dateStr,
  qty: z.coerce
    .number({ message: "Jumlah bibit wajib diisi" })
    .int("Jumlah bibit harus bilangan bulat")
    .refine((v) => v > 0, "Jumlah bibit harus lebih dari 0 — angka inilah yang menggerakkan biaya pengadaan bibit di Refleksi"),
});

export async function createSeedDistributionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    if (!ctx.companyId) return { ok: false, message: "Pilih satu entitas dulu di kanan atas." };
    const parsed = seedDistSchema.safeParse({
      seedBatchId: fd.get("seedBatchId"), blockId: fd.get("blockId"),
      distributedOn: fd.get("distributedOn"), qty: fd.get("qty") || "",
    });
    if (!parsed.success) return { ok: false, message: "Periksa isian.", fieldErrors: fieldErrors(parsed.error) };
    await createSeedDistribution(ctx, parsed.data);
    for (const p of ["/nursery", "/traceability", "/costing/refleksi", "/dashboard/financial"]) revalidatePath(p);
    return { ok: true, message: "Distribusi bibit tercatat — volume bibit terdistribusi dan Refleksi Biaya ikut diperbarui." };
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}

// --- Ajukan (semua modul operasional + aktivitas kebun) ---
// Halaman per modul (untuk revalidate). Modul aktivitas ada di /aktivitas/*,
// bukan /operasional/*, jadi pakai peta eksplisit — bukan tebak dari nama tabel.
const OP_MODULES = [
  "fertilizer_applications", "land_preparations", "land_suitability_assessments",
  "pruning_records", "weeding_records", "spraying_records", "harvest_records",
  "nursery_inspections", "dbh_measurements",
] as const;
const MODULE_PATH: Record<(typeof OP_MODULES)[number], string> = {
  fertilizer_applications: "/operasional/pemupukan",
  land_preparations: "/operasional/persiapan-lahan",
  land_suitability_assessments: "/operasional/kesesuaian-lahan",
  pruning_records: "/operasional/pruning",
  weeding_records: "/aktivitas/weeding",
  spraying_records: "/aktivitas/spraying",
  harvest_records: "/aktivitas/panen",
  nursery_inspections: "/nursery",
  dbh_measurements: "/keberlanjutan/karbon",
};
const submitSchema = z.object({ module: z.enum(OP_MODULES), id: uuid });

export async function submitOpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireRole("creator", "approver", "super_admin");
    const parsed = submitSchema.safeParse({ module: fd.get("module"), id: fd.get("id") });
    if (!parsed.success) return { ok: false, message: "Data tidak valid." };
    const n = await submitOpRecord(ctx, parsed.data.module, parsed.data.id);
    if (n === 0) return { ok: false, message: "Tidak bisa diajukan — statusnya bukan draft/ditolak." };
    revalidatePath(MODULE_PATH[parsed.data.module]);
    revalidatePath("/approval");
    return { ok: true, message: "Diajukan untuk approval." };
  } catch (e) { return { ok: false, message: toMessage(e) }; }
}
