"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";

import { setAppointmentStatusAction } from "@/app/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type RowAction = {
  id: string;
  status: string;
  labels: {
    confirm: string;
    complete: string;
    cancel: string;
    noShow: string;
    loading: string;
    done: string;
    failed: string;
  };
};

const NEXT_STATUS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** Inline status buttons with optimistic UI + server confirmation. */
export function StatusActions({ id, status, labels, locale }: RowAction & { locale: string }) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = React.useState(status);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(next: string) {
    setBusy(next);
    const previous = current;
    setCurrent(next);
    const result = await setAppointmentStatusAction(id, next, locale);
    setBusy(null);
    if (result.ok) {
      toast({ tone: "success", title: labels.done });
      router.refresh();
    } else {
      setCurrent(previous);
      toast({ tone: "error", title: labels.failed, description: result.error });
    }
  }

  const options = NEXT_STATUS[current] ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.includes("CONFIRMED") ? (
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("CONFIRMED")}>
          {busy === "CONFIRMED" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {labels.confirm}
        </Button>
      ) : null}
      {options.includes("COMPLETED") ? (
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("COMPLETED")}>
          {labels.complete}
        </Button>
      ) : null}
      {options.includes("NO_SHOW") ? (
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("NO_SHOW")}>
          {labels.noShow}
        </Button>
      ) : null}
      {options.includes("CANCELLED") ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-danger hover:bg-danger/10"
          disabled={busy !== null}
          onClick={() => run("CANCELLED")}
        >
          {busy === "CANCELLED" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <X className="size-3.5" aria-hidden />}
          {labels.cancel}
        </Button>
      ) : null}
      {options.length === 0 ? (
        <Badge tone="outline" className={cn("opacity-60")}>
          —
        </Badge>
      ) : null}
    </div>
  );
}
