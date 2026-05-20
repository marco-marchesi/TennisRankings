import { serializeLd } from "@/lib/schema-org";

type Json = Record<string, unknown>;

export function JsonLd({ data }: { data: Json | Json[] }) {
  return (
    <script
      type="application/ld+json"
      // Stringification is safe — we control the input shape.
      dangerouslySetInnerHTML={{ __html: serializeLd(data) }}
    />
  );
}
