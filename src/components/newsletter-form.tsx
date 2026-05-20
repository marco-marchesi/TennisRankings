"use client";

import { useState } from "react";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Submission failed");
      setState("ok");
      setMessage("Check your inbox to confirm.");
      setEmail("");
    } catch {
      setState("error");
      setMessage("Could not sign up — try again in a moment.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" aria-label="Newsletter signup">
      <label htmlFor="newsletter-email" className="sr-only">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="rounded-md bg-[color:var(--foreground)] px-4 py-2 text-sm text-[color:var(--background)] disabled:opacity-60"
      >
        {state === "loading" ? "Subscribing…" : "Subscribe"}
      </button>
      {message && (
        <p
          role={state === "error" ? "alert" : "status"}
          className="text-xs text-[color:var(--muted-foreground)] sm:basis-full"
        >
          {message}
        </p>
      )}
    </form>
  );
}
