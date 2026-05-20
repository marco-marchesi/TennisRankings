import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number, locale = "en-GB") {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatDate(d: Date | string, locale = "en-GB") {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function rankDelta(prev: number | null | undefined, current: number) {
  if (prev == null) return { dir: "hold" as const, delta: 0 };
  const delta = prev - current; // positive = moved up
  if (delta > 0) return { dir: "up" as const, delta };
  if (delta < 0) return { dir: "down" as const, delta: Math.abs(delta) };
  return { dir: "hold" as const, delta: 0 };
}

export function slugify(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
