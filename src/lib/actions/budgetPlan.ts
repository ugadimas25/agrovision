"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { TAHAP, PENGGERAK } from "@/lib/rab/daftar";
import {
  bacaWorkbookRab, type AsumsiImpor, type BarisImpor, type Masalah, type StatusModel,
} from "@/lib/rab/impor-excel";
import { listOptions } from "@/lib/repo/master";
import {
  addBudgetAssumption, addBudgetPlanItem, createBudgetPlan, createBudgetSource,
  decideBudgetPlan, deleteBudgetPlanItem, setBudgetPlanItemActive, submitBudgetPlan,
  updateBudgetAssumptionValue, updateBudgetPlanItems, imporBudgetPlanItems,
  imporBudgetAssumptions, listBudgetPlanItems,
} from "@/lib/repo/budgetPlan";

/**
 * Server Action modul Rencana Anggaran (RAB) — rapat Fadli 26 Agu 2026.
 *
 * Pembagian wewenangnya BUKAN diputuskan di sini, hanya diulang supaya pesannya
 * enak dibaca. Gerbang sebenarnya ada di database (migrasi 0060: policy
 * bp_writer_roles, bp_edit_gate, bpi_edit_*), yang tetap berlaku walau
 * requireRole di bawah ini terlewat — dan action bisa dipanggil POST langsung.
 *
 *   agronomist   menyusun, menyunting draft, mengajukan
 *   approver     memutuskan (finance), dan menambah baris setelah disetujui
 *   super_admin  keduanya
 *   creator      TIDAK menyentuh RAB — ia mencatat realisasi
 */

export type PlanState = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

const PENYUSUN = ["agronomist", "super_admin"] as const;
const PEMUTUS = ["approver", "super_admin"] as const;

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
  if (/budget_plans_code_key|budget_plans_company_id_code_key/.test(raw)) {
    return "Kode RAB itu sudah dipakai di entitas ini.";
  }
  if (/melewati horizon/.test(raw)) return raw;   // pesan trigger 0060 sudah jelas
  if (/rejection_needs_reason/.test(raw)) return "Penolakan wajib menyertakan alasan.";
  // 0063. Pesan trigger/CHECK-nya sudah menjelaskan diri, jadi diteruskan apa
  // adanya — kecuali dua yang butuh terjemahan dari nama constraint.
  if (/budget_sources_company_id_code_key/.test(raw)) {
    return "Kode sumber itu sudah dipakai di registri entitas ini.";
  }
  if (/budget_sources_url_check/.test(raw)) {
    return "URL harus diawali http:// atau https://. Sumber tanpa tautan cukup dikosongkan.";
  }
  if (/sudah dikutip RAB|tidak terdaftar di entitas/.test(raw)) return raw;
  if (/row-level security/.test(raw)) return "Anda tidak berhak mengubah RAB ini.";
  return raw;
}

const planSchema = z.object({
  code: z.string().trim().min(1, "Kode wajib diisi").max(60),
  name: z.string().trim().min(1, "Nama wajib diisi").max(200),
  // Luas boleh kosong: rapat memakai asumsi 100 ha, tapi asumsi belum tentu
  // sudah ada saat RAB mulai disusun. Kosong TIDAK diubah jadi 0 — nol hektar
  // adalah angka yang berarti "tidak ada lahan".
  areaHa: z.coerce.number().positive("Luas harus lebih dari 0").max(1e7).nullable().catch(null),
  horizonMonths: z.coerce.number().int().min(1).max(120),
  contingencyPct: z.coerce.number().min(0).max(100),
});

export async function createPlanAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole(...PENYUSUN);
    if (!ctx.companyId) {
      return { ok: false, message: "Pilih satu entitas dulu di pojok kanan atas — RAB selalu milik satu entitas." };
    }
    const raw = fd.get("areaHa");
    const parsed = planSchema.safeParse({
      code: fd.get("code"),
      name: fd.get("name"),
      areaHa: raw === null || String(raw).trim() === "" ? null : raw,
      horizonMonths: fd.get("horizonMonths") || 12,
      contingencyPct: fd.get("contingencyPct") ?? 5,
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await createBudgetPlan(ctx, parsed.data);
    revalidatePath("/costing/rencana-anggaran");
    return { ok: true, message: `RAB ${parsed.data.code} dibuat. Tambahkan komponen biayanya.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const itemSchema = z.object({
  planId: z.string().uuid(),
  phaseMonth: z.coerce.number().int().min(1, "Bulan ke- minimal 1").max(120),
  costCategoryId: z.string().uuid("Kategori biaya wajib dipilih"),
  description: z.string().trim().min(1, "Uraian wajib diisi").max(300),
  itemKind: z.enum(["consumable", "asset", "labor", "service"]),
  // Volume boleh 0/kosong bila diturunkan dari asumsi — trigger di database
  // yang mengisinya. Divalidasi ulang di refine() bawah.
  volume: z.coerce.number().min(0).max(1e12).catch(0),
  uomItemId: z.string().uuid().nullable().catch(null),
  unitPriceIdr: z.coerce.number().min(0, "Harga satuan tidak boleh negatif").max(1e15),
  note: z.string().trim().max(500).nullable().catch(null),
  // 0061, mengikuti 08_CAPEX_RAB pada model Banyumas.
  costKind: z.enum(["capex", "opex"]),
  // Daftar TERTUTUP, bukan sekadar dropdown di layar: Server Action bisa
  // dipanggil POST langsung tanpa melewati UI, jadi <select> saja bukan jaminan.
  // `.catch(null)` disengaja -- nilai di luar daftar diperlakukan sebagai
  // "belum ditentukan" dan tampil apa adanya di layar, bukan diam-diam
  // tersimpan sebagai tahap baru yang memecah pengelompokan CAPEX.
  stage: z.enum(TAHAP).nullable().catch(null),
  driver: z.enum(PENGGERAK).nullable().catch(null),
  sourceRef: z.string().trim().max(300).nullable().catch(null),
  // Sengaja TANPA default: menebak "medium" untuk baris yang belum ditelaah
  // membuat seluruh kolom keyakinan tidak berarti.
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null),
  excludeFromContingency: z.coerce.boolean().catch(false),
  // 0062: volume boleh diturunkan dari asumsi. Keduanya wajib berpasangan —
  // constraint bpi_basis_berpasangan menegakkan hal yang sama di database.
  basisCode: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/).nullable().catch(null),
  ratioPerBasis: z.coerce.number().positive().max(1e9).nullable().catch(null),
  // 0063: sumber dari registri. TIDAK wajib, dan itu disengaja — memaksa setiap
  // baris menunjuk registri hanya akan melahirkan sumber karangan agar formulir
  // lewat. sourceRef di atas tetap menampung keterangan bebas.
  sourceId: z.string().uuid().nullable().catch(null),
}).refine((v) => (v.basisCode === null) === (v.ratioPerBasis === null), {
  message: "Basis dan rasio harus diisi berpasangan", path: ["ratioPerBasis"],
}).refine((v) => v.basisCode !== null || v.volume > 0, {
  message: "Volume harus lebih dari 0, atau turunkan dari asumsi", path: ["volume"],
});

export async function addItemAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    // Penyusun DAN pemutus: rapat menyepakati finance boleh menambah baris
    // setelah RAB disetujui (mis. menyewa ahli hidrologi). Yang membatasi
    // KAPAN-nya bukan daftar peran ini, melainkan policy bpi_edit_insert.
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const uom = fd.get("uomItemId");
    const note = fd.get("note");
    const kosong = (v: FormDataEntryValue | null) =>
      v === null || String(v).trim() === "" ? null : v;
    const parsed = itemSchema.safeParse({
      planId: fd.get("planId"),
      phaseMonth: fd.get("phaseMonth"),
      costCategoryId: fd.get("costCategoryId"),
      description: fd.get("description"),
      itemKind: fd.get("itemKind") ?? "consumable",
      volume: fd.get("volume"),
      uomItemId: kosong(uom),
      unitPriceIdr: fd.get("unitPriceIdr"),
      note: kosong(note),
      costKind: fd.get("costKind") ?? "capex",
      stage: kosong(fd.get("stage")),
      driver: kosong(fd.get("driver")),
      sourceRef: kosong(fd.get("sourceRef")),
      confidence: kosong(fd.get("confidence")),
      excludeFromContingency: fd.get("excludeFromContingency") === "on",
      basisCode: kosong(fd.get("basisCode")),
      ratioPerBasis: kosong(fd.get("ratioPerBasis")),
      sourceId: kosong(fd.get("sourceId")),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await addBudgetPlanItem(ctx, parsed.data);
    revalidatePath(`/costing/rencana-anggaran/${parsed.data.planId}`);
    return { ok: true, message: "Komponen ditambahkan." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/**
 * Coret / hidupkan kembali satu baris — TIDAK menghapus.
 *
 * Mengikuti kolom `Aktif` di 17_Model_Fleksibel: "Aktif=0 mengeluarkan baris
 * dari total tanpa menghapus referensi". Baris yang dicoret finance minggu ini
 * bisa dihidupkan lagi bulan depan, dan pertanyaan "kenapa pos ini hilang?"
 * tetap punya jawaban di layar — bukan hanya di audit_log.
 */
export async function toggleItemAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const id = z.string().uuid().safeParse(fd.get("id"));
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    if (!id.success || !planId.success) return { ok: false, message: "Baris tidak valid." };
    const aktifkan = fd.get("aktifkan") === "1";

    const n = await setBudgetPlanItemActive(ctx, id.data, aktifkan);
    revalidatePath(`/costing/rencana-anggaran/${planId.data}`);
    // rowCount 0 = policy bpi_edit_update menyaringnya lewat USING, dan
    // penyaringan USING tidak melempar galat. Tanpa pesan ini, perubahan yang
    // ditolak terlihat seperti perubahan yang berhasil.
    if (n === 0) {
      return { ok: false, message: "Baris tidak bisa diubah — RAB ini sudah diajukan atau bukan susunan Anda." };
    }
    return { ok: true, message: aktifkan ? "Komponen dihidupkan kembali." : "Komponen dicoret dari total." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const barisBaruSchema = z.object({
  planId: z.string().uuid(),
  phaseMonth: z.coerce.number().int().min(1).max(600),
  costCategoryId: z.string().uuid("Kategori biaya wajib dipilih"),
  description: z.string().trim().min(1, "Uraian tidak boleh kosong").max(300),
  itemKind: z.enum(["consumable", "asset", "labor", "service"]),
  volume: z.coerce.number().positive("Volume harus lebih dari 0").max(1e12),
  uomItemId: z.string().uuid().nullable(),
  unitPriceIdr: z.coerce.number().min(0, "Harga satuan tidak boleh negatif").max(1e15),
  costKind: z.enum(["capex", "opex"]),
  stage: z.enum(TAHAP).nullable().catch(null),
});

const kosongkan = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === "" ? null : String(v);

const barisSchema = z.object({
  id: z.string().uuid(),
  phaseMonth: z.coerce.number().int().min(1).max(600),
  description: z.string().trim().min(1, "Uraian tidak boleh kosong").max(300),
  volume: z.coerce.number().min(0).max(1e12),
  unitPriceIdr: z.coerce.number().min(0, "Harga satuan tidak boleh negatif").max(1e15),
});

/**
 * Satu action untuk seluruh tabel sunting-langsung: simpan, coret, hapus.
 *
 * Dibedakan lewat name/value tombol yang DITEKAN (`_aksi`), bukan lewat tiga
 * <form> terpisah. Alasannya HTML, bukan selera: <form> tidak boleh bersarang
 * di dalam <tr>/<td>, dan menaruh satu form per baris di luar tabel lalu
 * merujuknya dengan atribut `form=` membuat urutan tab melompat-lompat di
 * pembaca layar. Dengan satu form, tabelnya tetap satu dokumen yang wajar,
 * tombolnya tetap tombol submit biasa, dan seluruhnya jalan tanpa JavaScript.
 */
export async function gridAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    // Daftar peran sengaja longgar; yang membatasi KAPAN dan BARIS MANA adalah
    // policy bpi_edit_update/bpi_edit_delete, bukan daftar ini.
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    if (!planId.success) return { ok: false, message: "RAB tidak valid." };
    const jalur = `/costing/rencana-anggaran/${planId.data}`;
    const aksi = String(fd.get("_aksi") ?? "simpan");

    const idDari = (awalan: string) => {
      const p = z.string().uuid().safeParse(aksi.slice(awalan.length));
      return p.success ? p.data : null;
    };

    if (aksi.startsWith("hapus:")) {
      const id = idDari("hapus:");
      if (!id) return { ok: false, message: "Baris tidak valid." };
      const n = await deleteBudgetPlanItem(ctx, planId.data, id);
      revalidatePath(jalur);
      // rowCount 0 = disaring policy lewat USING, yang TIDAK melempar. Tanpa
      // pesan ini, penghapusan yang ditolak terlihat seperti yang berhasil.
      return n === 0
        ? { ok: false, message: "Baris ini tidak bisa dihapus — RAB sudah diajukan/disetujui, atau bukan susunan Anda." }
        : { ok: true, message: "Baris dihapus." };
    }

    if (aksi.startsWith("coret:") || aksi.startsWith("hidup:")) {
      const hidupkan = aksi.startsWith("hidup:");
      const id = idDari(hidupkan ? "hidup:" : "coret:");
      if (!id) return { ok: false, message: "Baris tidak valid." };
      const n = await setBudgetPlanItemActive(ctx, id, hidupkan);
      revalidatePath(jalur);
      return n === 0
        ? { ok: false, message: "Baris ini tidak bisa diubah — RAB sudah diajukan/disetujui, atau bukan susunan Anda." }
        : { ok: true, message: hidupkan ? "Baris dihidupkan kembali dan masuk total." : "Baris dicoret dari total, tetap terlihat." };
    }

    if (aksi === "tambah") {
      // Baris kosong di ujung tabel -- "seperti Excel". Sengaja hanya membawa
      // kolom yang terlihat di tabel; tahap, penggerak, sumber, keyakinan, dan
      // basis asumsi tetap lewat form lengkap "Tambah komponen biaya".
      //
      // Akibatnya baris yang dibuat di sini tampil sebagai "keyakinan belum
      // dinilai" dan "sumber belum disebutkan" -- dan itu memang yang benar:
      // layar menunjukkan apa yang belum diisi, bukan menebakkan nilai untuknya.
      const p = barisBaruSchema.safeParse({
        planId: planId.data,
        phaseMonth: fd.get("baru_bulan"),
        costCategoryId: fd.get("baru_kategori"),
        description: fd.get("baru_uraian"),
        itemKind: fd.get("baru_jenis") ?? "consumable",
        volume: fd.get("baru_volume"),
        uomItemId: kosongkan(fd.get("baru_satuan")),
        unitPriceIdr: fd.get("baru_harga"),
        costKind: fd.get("baru_kind") ?? "capex",
        stage: kosongkan(fd.get("baru_tahap")),
      });
      if (!p.success) {
        return { ok: false, message: p.error.issues[0]?.message ?? "Isian baris baru tidak lengkap" };
      }
      await addBudgetPlanItem(ctx, {
        ...p.data, note: null, driver: null, sourceRef: null,
        confidence: null, excludeFromContingency: false, sourceId: null,
        basisCode: null, ratioPerBasis: null,
      });
      revalidatePath(jalur);
      return { ok: true, message: "Baris ditambahkan." };
    }

    // ---- simpan seluruh baris yang berubah -------------------------------
    const baris: { id: string; phaseMonth: number; description: string; volume: number; unitPriceIdr: number }[] = [];
    for (const kunci of fd.keys()) {
      if (!kunci.startsWith("uraian_")) continue;
      const id = z.string().uuid().safeParse(kunci.slice("uraian_".length));
      if (!id.success) continue;
      const p = barisSchema.safeParse({
        id: id.data,
        phaseMonth: fd.get(`bulan_${id.data}`),
        description: fd.get(`uraian_${id.data}`),
        // Baris turunan tidak punya input volume sama sekali (volumenya milik
        // trigger 0062). Nilainya diisi 0 dan diabaikan SQL -- lihat komentar
        // di updateBudgetPlanItems.
        volume: fd.get(`volume_${id.data}`) ?? 0,
        unitPriceIdr: fd.get(`harga_${id.data}`),
      });
      if (!p.success) {
        return { ok: false, message: p.error.issues[0]?.message ?? "Ada isian baris yang tidak valid" };
      }
      baris.push(p.data);
    }

    const berubah = await updateBudgetPlanItems(ctx, planId.data, baris);
    revalidatePath(jalur);
    if (baris.length === 0) return { ok: false, message: "Tidak ada baris untuk disimpan." };
    if (berubah.length === 0) {
      // Tidak bisa dibedakan dari sini apakah tidak ada yang diubah atau
      // semuanya disaring policy -- keduanya mengembalikan nol baris. Pesannya
      // karena itu menyebut kedua kemungkinan, bukan menebak salah satu.
      return { ok: true, message: "Tidak ada perubahan yang tersimpan. Kalau Anda memang mengubah sesuatu, RAB ini sudah diajukan/disetujui atau bukan susunan Anda." };
    }
    return { ok: true, message: `${berubah.length} baris disimpan.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

export async function submitPlanAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole(...PENYUSUN);
    const id = z.string().uuid().safeParse(fd.get("id"));
    if (!id.success) return { ok: false, message: "RAB tidak valid." };

    const n = await submitBudgetPlan(ctx, id.data);
    revalidatePath("/costing/rencana-anggaran");
    revalidatePath(`/costing/rencana-anggaran/${id.data}`);
    return n === 0
      ? { ok: false, message: "Tidak bisa diajukan — statusnya bukan draft/ditolak, atau bukan susunan Anda." }
      : { ok: true, message: "RAB diajukan ke finance." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const decisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).optional(),
}).refine((v) => v.decision !== "rejected" || (v.reason && v.reason.length > 0), {
  message: "Penolakan wajib menyertakan alasan", path: ["reason"],
});

export async function decidePlanAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole(...PEMUTUS);
    const parsed = decisionSchema.safeParse({
      id: fd.get("id"),
      decision: fd.get("decision"),
      reason: fd.get("reason") ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    const n = await decideBudgetPlan(ctx, parsed.data.id, parsed.data.decision, parsed.data.reason ?? null);
    revalidatePath("/costing/rencana-anggaran");
    revalidatePath(`/costing/rencana-anggaran/${parsed.data.id}`);
    if (n === 0) return { ok: false, message: "Tidak bisa diputuskan — statusnya bukan menunggu keputusan." };
    return {
      ok: true,
      message: parsed.data.decision === "approved"
        ? "RAB disetujui. Ia menjadi acuan anggaran."
        : "RAB ditolak beserta alasannya. Agronomis bisa memperbaiki lalu mengajukan ulang.",
    };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

const assumptionSchema = z.object({
  planId: z.string().uuid(),
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/,
    "Kode hanya huruf kecil, angka, dan garis bawah — mis. net_ha"),
  label: z.string().trim().min(1, "Nama asumsi wajib diisi").max(120),
  // Nol DIIZINKAN dan disengaja: di model Banyumas harga akuisisi lahan adalah
  // 0 dengan sumber "OPEN". Yang membedakannya dari "belum diisi" adalah
  // source_ref-nya, bukan angkanya.
  value: z.coerce.number().min(0).max(1e15),
  unit: z.string().trim().max(30).nullable().catch(null),
  sourceRef: z.string().trim().max(300).nullable().catch(null),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null),
  note: z.string().trim().max(500).nullable().catch(null),
  sourceId: z.string().uuid().nullable().catch(null),
});

export async function addAssumptionAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const kosong = (v: FormDataEntryValue | null) =>
      v === null || String(v).trim() === "" ? null : v;
    const parsed = assumptionSchema.safeParse({
      planId: fd.get("planId"),
      code: fd.get("code"),
      label: fd.get("label"),
      value: fd.get("value"),
      unit: kosong(fd.get("unit")),
      sourceRef: kosong(fd.get("sourceRef")),
      confidence: kosong(fd.get("confidence")),
      note: kosong(fd.get("note")),
      sourceId: kosong(fd.get("sourceId")),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await addBudgetAssumption(ctx, parsed.data);
    revalidatePath(`/costing/rencana-anggaran/${parsed.data.planId}`);
    return { ok: true, message: `Asumsi ${parsed.data.code} ditambahkan.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/**
 * Ubah nilai satu asumsi — dan dengan itu, seluruh baris yang menurunkannya.
 *
 * Efek berantainya dikerjakan trigger database (0062), bukan di sini: kalau
 * perkalian ulang hidup di TypeScript, satu jalur tulis yang lupa memanggilnya
 * akan meninggalkan RAB yang setengah berubah — dan RAB setengah berubah lebih
 * berbahaya daripada yang salah seluruhnya, karena ia terlihat konsisten.
 */
export async function updateAssumptionAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    const id = z.string().uuid().safeParse(fd.get("id"));
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    const value = z.coerce.number().min(0).max(1e15).safeParse(fd.get("value"));
    if (!id.success || !planId.success) return { ok: false, message: "Asumsi tidak valid." };
    if (!value.success) return { ok: false, message: "Nilai asumsi tidak valid." };
    // Kosong = sumber sengaja DILEPAS, bukan "tidak dikirim". Formulirnya selalu
    // menyertakan pilihan ini, jadi keduanya tidak bisa tertukar.
    const rawSumber = fd.get("sourceId");
    const sumber = rawSumber === null || String(rawSumber).trim() === ""
      ? null
      : z.string().uuid().safeParse(rawSumber);
    if (sumber !== null && !sumber.success) return { ok: false, message: "Sumber tidak valid." };

    const n = await updateBudgetAssumptionValue(
      ctx, id.data, value.data, sumber === null ? null : sumber.data);
    revalidatePath(`/costing/rencana-anggaran/${planId.data}`);
    return n === 0
      ? { ok: false, message: "Asumsi tidak bisa diubah — RAB ini sudah diajukan atau bukan susunan Anda." }
      : { ok: true, message: "Asumsi diperbarui. Baris yang memakainya ikut dihitung ulang." };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/**
 * Registri sumber (0063) — tahap 5 docs/19-rab-dari-excel-banyumas.md.
 *
 * Peran penulisnya sama dengan RAB: agronomis mendaftarkan rujukan teknis,
 * finance mendaftarkan penawaran vendor. Gerbang sebenarnya tetap di database
 * (policy bs_write_insert), yang berlaku walau requireRole di bawah terlewat.
 *
 * Registri milik ENTITAS, bukan satu RAB — karena itu tidak ada planId di sini.
 */
const sourceSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/,
    "Kode sumber: huruf/angka, boleh titik, garis, dan garis bawah — mis. S07"),
  topic: z.string().trim().max(120).nullable().catch(null),
  title: z.string().trim().min(1, "Judul sumber wajib diisi").max(300),
  // URL wajib benar-benar URL. Sumber lisan DIKOSONGKAN, tidak diisi kalimat:
  // tautan mati lebih buruk daripada tidak ada tautan, karena ia mengaku bisa
  // diperiksa. CHECK di 0063 menegakkan hal yang sama di database.
  url: z.url("URL harus diawali http:// atau https://").max(1000).nullable().catch(null),
  // Tanggal terbit dikosongkan bila sumbernya hanya menyebut tahun. Menebak
  // 1 Januari mengarang presisi yang tidak ada di sumbernya.
  publishedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  accessedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  confidence: z.enum(["high", "medium", "low"]).nullable().catch(null),
  note: z.string().trim().max(1000).nullable().catch(null),
});

export async function addSourceAction(_p: PlanState, fd: FormData): Promise<PlanState> {
  try {
    const ctx = await requireRole("agronomist", "approver", "super_admin");
    if (!ctx.companyId) {
      return { ok: false, message: "Pilih satu entitas dulu di pojok kanan atas — registri sumber milik satu entitas." };
    }
    const kosong = (v: FormDataEntryValue | null) =>
      v === null || String(v).trim() === "" ? null : v;
    const parsed = sourceSchema.safeParse({
      code: fd.get("code"),
      topic: kosong(fd.get("topic")),
      title: fd.get("title"),
      url: kosong(fd.get("url")),
      publishedOn: kosong(fd.get("publishedOn")),
      accessedOn: kosong(fd.get("accessedOn")),
      confidence: kosong(fd.get("confidence")),
      note: kosong(fd.get("note")),
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Isian tidak valid", fieldErrors: fieldErrors(parsed.error) };
    }
    await createBudgetSource(ctx, parsed.data);
    // Registri dipakai seluruh RAB entitas ini, bukan hanya yang sedang dibuka.
    revalidatePath("/costing/rencana-anggaran", "layout");
    return { ok: true, message: `Sumber ${parsed.data.code} masuk registri.` };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

// ===========================================================================
// Impor berkas Excel (template RAB_Agroforestry_100ha_Banyumas_R2.xlsx)
//
// DUA LANGKAH, dan langkah pratinjau bukan hiasan. Berkasnya tidak membawa
// kategori biaya sama sekali (`cost_category_id` wajib di 0060), satuannya
// teks bebas yang belum tentu ada di master, dan sebagian tahap/penggerak bisa
// di luar daftar tertutup. Menulis langsung berarti menebak ketiganya. Yang
// dilakukan di sini: tunjukkan apa yang terbaca, apa yang tidak, dan minta
// pengguna memetakan sisanya -- baru menulis.
//
// Sheet yang dibaca hanya 02_Assumptions dan 08_CAPEX_RAB. 05_Workplan_Labor,
// 06_Equipment_Tools, 07_Agri_Inputs, dan 09_OPEX_10Y sengaja TIDAK diimpor:
// ketiganya memakai rentang tahun (Mulai/Selesai, T1..T10, umur manfaat) yang
// belum punya tempat di skema -- itu tahap 4 di docs/19. Pratinjau menyebutkan
// ini apa adanya, karena RAB yang diam-diam hanya berisi CAPEX terlihat seperti
// RAB yang lengkap.
// ===========================================================================

export type ImporState = {
  ok: boolean;
  message: string;
  pratinjau?: {
    skenario: "1lokasi" | "4lokasi";
    namaBerkas: string;
    asumsi: AsumsiImpor[];
    komponen: BarisImpor[];
    masalah: Masalah[];
    /** Tahap unik yang perlu dipetakan ke kategori biaya oleh pengguna. */
    tahapUnik: string[];
    /** Satuan di berkas yang tidak ketemu di master; barisnya tetap masuk, uom-nya null. */
    satuanTidakDikenal: string[];
    komponenSudahAda: number;
    /** Status konsistensi model dari sheet 15_Checks; null bila sheet tak ada. */
    statusModel: StatusModel | null;
    /** Berapa banyak angka yang di berkas berupa RUMUS, bukan ketikan. */
    turunan: { volume: number; harga: number; total: number };
    /** Bulan mulai per tahap dari sheet 05; kunci tanpa awalan huruf. */
    jadwalTahap: Record<string, number>;
  };
};

const imporKosong: ImporState = { ok: false, message: "" };

export async function pratinjauImporAction(_p: ImporState, fd: FormData): Promise<ImporState> {
  try {
    const ctx = await requireRole("agronomist", "super_admin");
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    if (!planId.success) return { ...imporKosong, message: "RAB tidak valid." };

    const berkas = fd.get("berkas");
    if (!(berkas instanceof File) || berkas.size === 0) {
      return { ...imporKosong, message: "Pilih berkas Excel-nya dulu." };
    }
    // 8 MB adalah batas serverActions.bodySizeLimit di next.config; ditolak di
    // sini supaya pesannya jelas, bukan galat 413 yang tidak bisa dibaca.
    if (berkas.size > 7_500_000) {
      return { ...imporKosong, message: "Berkas lebih dari 7,5 MB. Hapus sheet yang tidak perlu, atau simpan ulang sebagai .xlsx." };
    }
    const skenario = fd.get("skenario") === "4lokasi" ? "4lokasi" : "1lokasi";

    const hasil = bacaWorkbookRab(await berkas.arrayBuffer(), { skenario });
    if (hasil.komponen.length === 0 && hasil.asumsi.length === 0) {
      return {
        ...imporKosong,
        message: "Tidak ada baris yang terbaca. Pastikan berkasnya template RAB (butuh sheet 02_Assumptions dan 08_CAPEX_RAB).",
      };
    }

    const uoms = await listOptions(ctx, "unit_of_measure");
    const dikenal = new Set(uoms.map((u) => u.label.toLowerCase().trim()));
    const satuanTidakDikenal = [...new Set(
      hasil.komponen.map((k) => k.satuanTeks).filter((s): s is string => Boolean(s))
        .filter((s) => !dikenal.has(s.toLowerCase().trim())),
    )];
    const tahapUnik = [...new Set(hasil.komponen.map((k) => k.tahap).filter((t): t is string => Boolean(t)))];
    const komponenSudahAda = (await listBudgetPlanItems(ctx, planId.data)).length;

    return {
      ok: true,
      message: `${hasil.komponen.length} komponen dan ${hasil.asumsi.length} asumsi terbaca dari ${berkas.name}.`,
      pratinjau: {
        skenario, namaBerkas: berkas.name, asumsi: hasil.asumsi, komponen: hasil.komponen,
        masalah: hasil.masalah, tahapUnik, satuanTidakDikenal, komponenSudahAda,
        statusModel: hasil.statusModel,
        jadwalTahap: hasil.jadwalTahap,
        turunan: {
          volume: hasil.komponen.filter((k) => k.volumeDariRumus).length,
          harga: hasil.komponen.filter((k) => k.hargaDariRumus).length,
          total: hasil.komponen.length,
        },
      },
    };
  } catch (e) {
    return { ...imporKosong, message: toMessage(e) };
  }
}

/** Bentuk muatan pratinjau yang dikirim balik dari layar. Divalidasi ulang di
 *  sini, tidak dipercaya begitu saja: yang bulak-balik lewat peramban harus
 *  diperiksa lagi seperti kiriman mana pun. */
const muatanSchema = z.object({
  komponen: z.array(z.object({
    barisAsli: z.number().int(),
    uraian: z.string().trim().min(1).max(300),
    tahap: z.string().nullable(),
    penggerak: z.string().nullable(),
    volume: z.number().nullable(),
    satuanTeks: z.string().nullable(),
    hargaSatuan: z.number().nullable(),
    sumberRef: z.string().nullable(),
  })).max(2000),
  asumsi: z.array(z.object({
    barisAsli: z.number().int(),
    variabel: z.string().trim().min(1).max(120),
    nilai: z.number().nullable(),
    satuan: z.string().nullable(),
    idSumber: z.string().nullable(),
    keyakinan: z.enum(["high", "medium", "low"]).nullable(),
    catatan: z.string().nullable(),
  })).max(500),
});

/** Kode asumsi dibuat dari nama variabelnya: huruf kecil, non-alfanumerik jadi
 *  garis bawah. Kolom `code` punya UNIQUE(plan_id, code) dan dipakai
 *  `basis_code` pada baris turunan, jadi ia harus stabil dan bisa ditebak
 *  orang -- "Luas bruto" selalu jadi `luas_bruto`, bukan nomor acak. */
function kodeAsumsi(variabel: string): string {
  const k = variabel.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(k) ? k : `a_${k}`.slice(0, 40);
}

export async function jalankanImporAction(_p: ImporState, fd: FormData): Promise<ImporState> {
  try {
    const ctx = await requireRole("agronomist", "super_admin");
    const planId = z.string().uuid().safeParse(fd.get("planId"));
    if (!planId.success) return { ...imporKosong, message: "RAB tidak valid." };

    let mentah: unknown;
    try { mentah = JSON.parse(String(fd.get("muatan") ?? "")); }
    catch { return { ...imporKosong, message: "Data pratinjau rusak. Unggah ulang berkasnya." }; }
    const muatan = muatanSchema.safeParse(mentah);
    if (!muatan.success) return { ...imporKosong, message: "Data pratinjau tidak valid. Unggah ulang berkasnya." };

    // Pemetaan tahap -> kategori biaya, diisi pengguna di pratinjau. Berkasnya
    // tidak punya kolom kategori sama sekali, dan cost_category_id wajib.
    const petaKategori = new Map<string, string>();
    // Bulan fase per tahap. Berkasnya tidak memuat bulan di 08_CAPEX_RAB, jadi
    // tanpa ini seluruh baris menumpuk di bulan ke-1 dan "sebaran per bulan"
    // menjadi satu batang tunggal yang tidak memberi tahu apa pun.
    const petaBulan = new Map<string, number>();
    for (const kunci of fd.keys()) {
      if (kunci.startsWith("kategori_")) {
        const nilai = z.string().uuid().safeParse(fd.get(kunci));
        if (nilai.success) petaKategori.set(kunci.slice("kategori_".length), nilai.data);
      } else if (kunci.startsWith("bulanTahap_")) {
        const nilai = z.coerce.number().int().min(1).max(600).safeParse(fd.get(kunci));
        if (nilai.success) petaBulan.set(kunci.slice("bulanTahap_".length), nilai.data);
      }
    }

    const uoms = await listOptions(ctx, "unit_of_measure");
    const petaUom = new Map(uoms.map((u) => [u.label.toLowerCase().trim(), u.value]));

    const dilewati: string[] = [];
    const baris = muatan.data.komponen.flatMap((k) => {
      const kategori = k.tahap ? petaKategori.get(k.tahap) : undefined;
      if (!kategori) {
        dilewati.push(`baris ${k.barisAsli} (${k.uraian}): tahap belum dipetakan ke kategori biaya`);
        return [];
      }
      // Volume 0 BUKAN sama dengan volume kosong, dan template R2 memakai
      // keduanya dengan sengaja: baris "Cover crop/insectary establishment"
      // bervolume 0 karena biayanya sudah dihitung di 17_Model_Fleksibel supaya
      // tidak dobel. CHECK (volume > 0) di 0060 menolaknya, jadi ia dilewati --
      // tapi alasannya disebut apa adanya, bukan disamakan dengan sel kosong.
      if (k.volume === 0) {
        dilewati.push(`baris ${k.barisAsli} (${k.uraian}): volumenya 0 di berkas — biasanya karena biayanya sudah dihitung di sheet lain`);
        return [];
      }
      if (k.volume === null || k.volume < 0 || k.hargaSatuan === null) {
        dilewati.push(`baris ${k.barisAsli} (${k.uraian}): volume atau harga satuan kosong di berkas`);
        return [];
      }
      return [{
        // 08_CAPEX_RAB tidak punya kolom bulan. Yang dipakai adalah bulan yang
        // DITETAPKAN PENGGUNA per tahap di pratinjau -- boleh diisi sendiri,
        // boleh diambil dari jadwal sheet 05 lewat tombol. Bila tidak diisi,
        // jatuh ke bulan ke-1 dan pratinjau mengatakannya.
        phaseMonth: (k.tahap && petaBulan.get(k.tahap)) || 1,
        costCategoryId: kategori,
        description: k.uraian,
        // Tidak ada kolom jenis di berkas. 'consumable' adalah default kolomnya
        // di 0060, dipakai apa adanya dan bukan tebakan dari uraian.
        itemKind: "consumable",
        volume: k.volume,
        uomItemId: k.satuanTeks ? (petaUom.get(k.satuanTeks.toLowerCase().trim()) ?? null) : null,
        unitPriceIdr: k.hargaSatuan,
        // 08_CAPEX_RAB adalah sheet investasi awal; seluruh barisnya capex.
        costKind: "capex" as const,
        stage: (TAHAP as readonly string[]).includes(k.tahap ?? "") ? k.tahap : null,
        driver: (PENGGERAK as readonly string[]).includes(k.penggerak ?? "") ? k.penggerak : null,
        sourceRef: k.sumberRef,
      }];
    });

    const asumsi = muatan.data.asumsi.flatMap((a) => {
      if (a.nilai === null) {
        dilewati.push(`asumsi baris ${a.barisAsli} (${a.variabel}): nilainya kosong di berkas`);
        return [];
      }
      return [{
        code: kodeAsumsi(a.variabel), label: a.variabel, value: a.nilai,
        unit: a.satuan, sourceRef: a.idSumber, confidence: a.keyakinan, note: a.catatan,
      }];
    });

    const nAsumsi = await imporBudgetAssumptions(ctx, planId.data, asumsi);
    const nBaris = await imporBudgetPlanItems(ctx, planId.data, baris);
    revalidatePath(`/costing/rencana-anggaran/${planId.data}`);

    if (nBaris === 0 && nAsumsi === 0) {
      return { ...imporKosong, message: "Tidak ada yang masuk. RAB ini mungkin sudah diajukan, atau bukan susunan Anda." };
    }
    const kurang = baris.length - nBaris;
    // Bulan yang BENAR-BENAR dipakai, bukan kalimat tetap. Pesan sebelumnya
    // selalu berbunyi "Semua masuk bulan ke-1" meski bulannya diisi — kalimat
    // tetap yang berbohong begitu perilakunya berubah, dan tidak ada yang
    // menangkapnya karena ia bukan angka yang dihitung dari apa pun.
    const bulanDipakai = [...new Set(baris.map((b) => b.phaseMonth))].sort((a, b) => a - b);
    const sebaran = bulanDipakai.length === 0 ? ""
      : bulanDipakai.length === 1 ? ` Semua masuk bulan ke-${bulanDipakai[0]}.`
      : ` Tersebar ke bulan ${bulanDipakai.join(", ")}.`;
    const nLewatKomponen = muatan.data.komponen.length - baris.length;
    const nLewatAsumsi = muatan.data.asumsi.length - asumsi.length;
    const catatan = [
      nLewatKomponen > 0 ? `${nLewatKomponen} komponen dilewati` : "",
      nLewatAsumsi > 0 ? `${nLewatAsumsi} asumsi dilewati` : "",
    ].filter(Boolean).join(", ");
    return {
      ok: kurang === 0,
      message: kurang === 0
        ? `Impor selesai: ${nBaris} komponen, ${nAsumsi} asumsi.${catatan ? ` ${catatan}.` : ""}${sebaran}`
        : `Hanya ${nBaris} dari ${baris.length} komponen yang masuk; sisanya ditolak policy RAB ini.${catatan ? ` ${catatan}.` : ""}`,
    };
  } catch (e) {
    return { ...imporKosong, message: toMessage(e) };
  }
}
