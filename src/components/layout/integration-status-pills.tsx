"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, CircleDot, XCircle } from "lucide-react";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { dedupFetch } from "@/lib/api/dedup-fetch";
import { useIsCloud } from "@/lib/cloud/client-tier";
import { useAppStore } from "@/stores/app-store";
import { useLocale } from "@/i18n/use-locale";
import type { IntegrationStatus } from "@/lib/integrations/status-probe";

const POLL_MS = 15_000;

/**
 * Status-bar pills for connected integrations that run their own server.
 *
 * An integration appears here by declaring a `statusProbe` in the catalog, so
 * this component knows nothing about any particular vendor. Nothing renders
 * when no connected integration declares one, which is the common case — the
 * bar stays as it was.
 *
 * State reads by shape as well as hue (Audit #100): a filled dot for healthy,
 * a triangle for up-but-not-ready, a cross for unreachable. Unlike the app's
 * own server pill, a healthy pill keeps muted label text and lets the dot
 * carry the state — there is one server pill but there can be several of
 * these, and a row of full-green pills would swamp the bar. Trouble still
 * takes the colour, so it stands out.
 */
export function IntegrationStatusPills() {
  const { t } = useLocale();
  const isCloud = useIsCloud();
  const setSection = useAppStore((s) => s.setSection);
  const [items, setItems] = useState<IntegrationStatus[]>([]);

  const refresh = useCallback(async () => {
    // The route answers with nothing on cloud, so do not pay a request per
    // client per tick to be told so.
    if (isCloud) return;
    try {
      const res = await dedupFetch("/api/integrations/status");
      if (!res.ok) return;
      const body = (await res.json()) as { integrations?: IntegrationStatus[] };
      setItems(body.integrations ?? []);
    } catch {
      // A failed poll leaves the last known state on screen rather than
      // flashing the pills off; the next tick corrects it.
    }
  }, [isCloud]);

  useVisibleInterval(refresh, POLL_MS);

  if (items.length === 0) return null;

  return (
    // A pill that turns red is the whole point, and colour alone announces
    // nothing. `polite` so it waits for a pause rather than interrupting.
    <span role="status" aria-live="polite" className="contents">
      {items.map((item) => {
        const online = item.state === "online";
        const label = online && item.detail ? `${item.label} · ${item.detail}` : item.label;
        const title =
          item.state === "offline"
            ? t("status:integration.offline", { name: item.label })
            : item.state === "notReady"
              ? t("status:integration.notReady", { name: item.label })
              : item.detail
                ? t("status:integration.onlineWithDetail", { name: item.label, detail: item.detail })
                : t("status:integration.online", { name: item.label });
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection({ type: "integrations", slug: item.id })}
            className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 ${
              item.state === "offline"
                ? "text-red-500 hover:bg-red-500/10"
                : item.state === "notReady"
                  ? "text-amber-500 hover:bg-amber-500/10"
                  : "hover:bg-muted/40"
            }`}
            title={title}
            aria-label={title}
            data-integration-status={item.state}
          >
            {online ? (
              <CircleDot className="h-3 w-3 shrink-0 text-green-500" aria-hidden="true" />
            ) : item.state === "notReady" ? (
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <span className="@max-[820px]:hidden">{label}</span>
          </button>
        );
      })}
    </span>
  );
}
