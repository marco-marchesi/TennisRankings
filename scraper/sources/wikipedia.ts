import { politeFetch } from "../http";
import { z } from "zod";

// Wikipedia's Action API. CC BY-SA — must attribute on player pages.
// We use this purely for: bio summary, photo URL on Commons, date of birth,
// and external links. Never use it for ranking points.

const ApiResponse = z.object({
  query: z.object({
    pages: z.record(
      z.object({
        title: z.string(),
        extract: z.string().optional(),
        thumbnail: z
          .object({
            source: z.string(),
            width: z.number(),
            height: z.number(),
          })
          .optional(),
        fullurl: z.string().optional(),
      }),
    ),
  }),
});

export interface PlayerBio {
  fullName: string;
  extract?: string;
  photoUrl?: string;
  wikipediaUrl?: string;
  attribution: string;
}

export async function fetchPlayerBio(fullName: string): Promise<PlayerBio | null> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "extracts|pageimages|info",
    exintro: "1",
    explaintext: "1",
    pithumbsize: "400",
    inprop: "url",
    titles: fullName,
    redirects: "1",
    origin: "*",
  }).toString();

  const res = await politeFetch(url.toString());
  const json = ApiResponse.parse(await res.json());
  const page = Object.values(json.query.pages)[0];
  if (!page || !page.extract) return null;
  return {
    fullName: page.title,
    extract: page.extract,
    photoUrl: page.thumbnail?.source,
    wikipediaUrl: page.fullurl,
    attribution: `Wikipedia / Wikimedia Commons (CC BY-SA 4.0)`,
  };
}
