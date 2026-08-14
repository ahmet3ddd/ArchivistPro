// Proje onay-durumu ortak yardimcilari (H2 pariti) — detay formu (ProjectSection)
// + facet kenar cubugu (FacetSidebar) paylasir. Sunucu whitelist'i ile birebir:
// "draft" | "review" | "approved" | "rejected" (bos/null = ayarlanmamis).

import type { TFunction } from "i18next";

/** Gecerli onay durumlari (sunucu whitelist'i; bos = ayarlanmamis). */
export const APPROVAL_STATUSES = ["draft", "review", "approved", "rejected"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Ham onay-durumu degeri → yerel etiket. Bilinmeyen/null → "Belirtilmemis". */
export function approvalStatusLabel(value: string | null, t: TFunction): string {
  switch (value) {
    case "draft":
      return t("project.status_draft");
    case "review":
      return t("project.status_review");
    case "approved":
      return t("project.status_approved");
    case "rejected":
      return t("project.status_rejected");
    default:
      return t("project.status_unset");
  }
}
