import { ImageResponse } from "next/og";
import { getPlayerBySlug } from "@/lib/players";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Player card";

export default async function OG({ params }: { params: { slug: string } }) {
  const p = await getPlayerBySlug(params.slug);
  const name = p?.fullName ?? "Player";
  const country = p?.countryCode ?? "";
  const tour = (p?.tour ?? "atp").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0a1628 0%, #152540 100%)",
          color: "white",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.7, letterSpacing: 2 }}>TENNISRANKINGS · {tour}</div>
        <div>
          <div style={{ fontSize: 96, fontWeight: 600, lineHeight: 1.0 }}>{name}</div>
          <div style={{ fontSize: 36, marginTop: 16, color: "#00e87a" }}>{country}</div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 24, opacity: 0.85 }}>
          <span>Ranking · Form · H2H</span>
          <span style={{ marginLeft: "auto" }}>tennisrankings.example</span>
        </div>
      </div>
    ),
    size,
  );
}
