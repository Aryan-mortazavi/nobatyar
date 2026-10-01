"use client";

import * as React from "react";
import { BellRing, Loader2, Trash2 } from "lucide-react";

import { notifyWaitlistAction, removeWaitlistAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Locale } from "@/lib/i18n";

export function WaitlistRowActions({
  id,
  locale,
  status,
  labels,
}: {
  id: string;
  locale: Locale;
  status: string;
  labels: { notify: string; remove: string; done: string; failed: string };
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<"notify" | "remove" | null>(null);

  return (
    <div className="flex items-center justify-end gap-1.5">
      {status === "PENDING" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("notify");
            const result = await notifyWaitlistAction(id, locale);
            setBusy(null);
            toast(
              result.ok
                ? { tone: "success", title: labels.done }
                : { tone: "error", title: labels.failed, description: result.error },
            );
          }}
        >
          {busy === "notify" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <BellRing className="size-3.5" aria-hidden />
          )}
          {labels.notify}
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-danger hover:bg-danger/10"
        disabled={busy !== null}
        aria-label={labels.remove}
        onClick={async () => {
          setBusy("remove");
          const result = await removeWaitlistAction(id, locale);
          setBusy(null);
          toast(
            result.ok
              ? { tone: "success", title: labels.done }
              : { tone: "error", title: labels.failed },
          );
        }}
      >
        {busy === "remove" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}
