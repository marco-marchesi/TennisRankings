import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">404</p>
      <h1 className="mt-2 font-serif text-4xl">Out of the draw.</h1>
      <p className="mt-3 text-[color:var(--muted-foreground)]">
        That page doesn't exist. Try the{" "}
        <Link href="/rankings/atp" className="underline">ATP rankings</Link>,{" "}
        the <Link href="/rankings/wta" className="underline">WTA rankings</Link>, or
        search a player from the top bar.
      </p>
    </div>
  );
}
