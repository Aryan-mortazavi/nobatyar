import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { Skeleton } from "./badge";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("text-muted-foreground", className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-muted/40", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: cols }).map((__, colIndex) => (
            <Skeleton key={colIndex} className="h-9 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Link-based pagination: a Server Component cannot pass an `onPage` handler to
 * a Client Component, so the parent supplies the path and the query instead.
 */
export function Pagination({
  page,
  totalPages,
  basePath,
  params = {},
  labels,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  labels: { page: string; of: string; previous: string; next: string };
}) {
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-border px-4 py-3" aria-label="Pagination">
      <span className="text-xs text-muted-foreground">
        {labels.page} {page} {labels.of} {totalPages}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            {labels.previous}
          </Link>
        ) : (
          <span className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium opacity-40">
            {labels.previous}
          </span>
        )}
        {page < totalPages ? (
          <Link
            href={href(page + 1)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            {labels.next}
          </Link>
        ) : (
          <span className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium opacity-40">
            {labels.next}
          </span>
        )}
      </div>
    </nav>
  );
}
