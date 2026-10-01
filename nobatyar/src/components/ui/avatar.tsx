"use client";

import * as React from "react";

import { cn, colorFromString, initials } from "@/lib/utils";

/**
 * Initials avatar with a graceful image fallback.
 * Client component because a broken image URL must fall back at runtime.
 */
export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: showImage ? undefined : colorFromString(name),
        fontSize: Math.max(11, size / 2.8),
      }}
      aria-hidden={!showImage}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
