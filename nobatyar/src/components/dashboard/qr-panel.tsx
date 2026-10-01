"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Printer,
  QrCode as QrIcon,
  Share2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type QrTarget = {
  id: string;
  label: string;
  detail?: string;
  url: string;
  svg: string;
};

/**
 * Link + QR panel: the two ways a customer reaches the booking page.
 *  · the URL (copy / open / embed)
 *  · the QR code (download SVG or PNG, print a poster)
 */
export function QrPanel({
  targets,
  businessName,
  labels,
  accentColor,
}: {
  targets: QrTarget[];
  businessName: string;
  labels: {
    link: string;
    linkHint: string;
    copy: string;
    copied: string;
    open: string;
    download: string;
    downloadPng: string;
    print: string;
    share: string;
    embed: string;
    embedCopied: string;
    qrTitle: string;
    qrHint: string;
    services: string;
    allServices: string;
    mainPage: string;
  };
  accentColor: string;
}) {
  const toast = useToast();
  const [copied, setCopied] = React.useState<string | null>(null);
  const main = targets[0];

  async function copy(value: string, key: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard can be blocked (insecure context) → fall back to a textarea
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(key);
    window.setTimeout(() => setCopied(null), 2000);
    toast({ tone: "success", title: message });
  }

  function embedCode(url: string): string {
    return `<iframe src="${url}" title="${businessName}" width="420" height="640" style="border:0;border-radius:16px"></iframe>`;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      {/* ── QR poster ─────────────────────────────────────────────── */}
      <Card padding="none" className="overflow-hidden print:border-0 print:shadow-none print:ring-0">
        <div
          className="flex flex-col items-center gap-6 p-8"
          style={{
            background: `linear-gradient(160deg, color-mix(in oklab, ${accentColor} 14%, transparent), transparent 60%)`,
          }}
        >
          <div className="rounded-3xl border border-border bg-white p-6 shadow-xl">
            {/* SVG is generated on the server: crisp at any size, printable */}
            <div
              data-testid="qr-main"
              className="size-64 sm:size-72"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: main.svg }}
            />
          </div>

          <div className="space-y-1 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {labels.qrTitle}
            </p>
            <p className="text-lg font-bold">{labels.mainPage}</p>
            <p className="text-sm text-muted-foreground">{labels.qrHint}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([main.svg], { type: "image/svg+xml" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "nobatyar-qr.svg";
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download aria-hidden />
              {labels.download}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/qr?data=${encodeURIComponent(main.url)}&format=png&size=1024`} download>
                <Download aria-hidden />
                {labels.downloadPng}
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer aria-hidden />
              {labels.print}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── link + per-service codes ──────────────────────────────── */}
      <div className="space-y-4">
        <Card padding="lg" className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Link2 className="size-4.5" aria-hidden />
            </span>
            <div>
              <h3 className="font-semibold">{labels.link}</h3>
              <p className="text-xs text-muted-foreground">{labels.linkHint}</p>
            </div>
          </div>

          <Field label={labels.mainPage}>
            <div className="flex gap-2">
              <Input readOnly value={main.url} dir="ltr" className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => copy(main.url, "main", labels.copied)}
                aria-label={labels.copy}
              >
                {copied === "main" ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm">
              <a href={main.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                {labels.open}
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (navigator.share) {
                  await navigator.share({ title: businessName, url: main.url }).catch(() => undefined);
                } else {
                  await copy(main.url, "share", labels.copied);
                }
              }}
            >
              <Share2 aria-hidden />
              {labels.share}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(embedCode(main.url), "embed", labels.embedCopied)}
            >
              <QrIcon aria-hidden />
              {labels.embed}
            </Button>
          </div>
        </Card>

        {targets.length > 1 ? (
          <Card padding="lg">
            <h3 className="font-semibold">{labels.services}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{labels.allServices}</p>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {targets.slice(1).map((target) => (
                <li
                  key={target.id}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-background/60 p-3 text-center"
                >
                  <div
                    className="size-20"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: target.svg }}
                  />
                  <p className="line-clamp-2 text-xs font-medium">{target.label}</p>
                  {target.detail ? (
                    <p className="text-[11px] text-muted-foreground">{target.detail}</p>
                  ) : null}
                  <div className="mt-auto flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={labels.copy}
                      onClick={() => copy(target.url, target.id, labels.copied)}
                    >
                      {copied === target.id ? <Check aria-hidden /> : <Copy aria-hidden />}
                    </Button>
                    <Button asChild variant="ghost" size="icon-sm">
                      <a
                        href={`/api/qr?data=${encodeURIComponent(target.url)}&format=png&size=512`}
                        download
                        aria-label={labels.downloadPng}
                      >
                        <Download aria-hidden />
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export { cn };
