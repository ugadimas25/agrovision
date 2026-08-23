import { Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/ui/PlaceholderPage";
import { AksesDitolak } from "@/components/ui/AksesDitolak";
import { requirePageRole } from "@/lib/session";
import { getLocale } from "@/lib/i18n-server";
import { getDict } from "@/lib/i18n";

/**
 * Landing grup Pengaturan. Masih placeholder, tapi tetap dipagari: sebelum
 * AI-27b halaman ini tidak memanggil gate apa pun -- hanya autentikasi dari
 * src/components/layout/AppLayout.tsx, sehingga setiap peran bisa membukanya.
 * Yang dipagari adalah ROUTE-nya; begitu isinya nyata, gate-nya sudah di tempat.
 */
export default async function PengaturanPage() {
  const gate = await requirePageRole("super_admin");
  const t = getDict(await getLocale());
  if (!gate.ok) {
    return (
      <AksesDitolak title={t("nav.group.settings")} role={gate.role} allowed={["super_admin"]} />
    );
  }
  return (
    <PlaceholderPage
      title={t("nav.group.settings")}
      subtitle={t("sub.settings")}
      icon={Settings}
      note="Pengaturan umum platform: master data estate/blok, emission factor library, integrasi ERP/accounting, dan preferensi notifikasi."
    />
  );
}
