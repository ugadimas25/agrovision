/** PENOPANG SEMENTARA — diganti modul pembaca xlsx yang sesungguhnya. */
export type BarisImpor = {
  barisAsli: number; uraian: string; tahap: string | null; penggerak: string | null;
  volume: number | null; satuanTeks: string | null; hargaSatuan: number | null;
  sumberRef: string | null; totalDiSheet: number | null;
};
export type AsumsiImpor = {
  barisAsli: number; kelompok: string | null; variabel: string; nilai: number | null;
  satuan: string | null; idSumber: string | null;
  keyakinan: "high" | "medium" | "low" | null; catatan: string | null;
};
export type Masalah = { sheet: string; baris: number; pesan: string };
export type HasilImpor = { asumsi: AsumsiImpor[]; komponen: BarisImpor[]; masalah: Masalah[] };

export function bacaWorkbookRab(
  _buf: Buffer | ArrayBuffer,
  _opts: { skenario: "1lokasi" | "4lokasi" },
): HasilImpor {
  throw new Error("Pembaca berkas Excel belum terpasang.");
}
