import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "About TennisRankings",
  description: "Who runs the site, where the data comes from, and how it stays independent.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 prose dark:prose-invert">
      <h1>About TennisRankings</h1>

      <p>
        TennisRankings is an independent project that surfaces what the
        official ATP and WTA tour data is too polite to show: where the
        rankings are <em>going</em>. Points-expiry windows, head-to-heads,
        surface splits, ranking projections — built for fans who think
        about tennis the way the players' coaches do.
      </p>

      <h2>Who runs it</h2>
      <p>
        Built and maintained solo by Marco Marchesi. If you spot an error
        or have a feature idea, drop a line to{" "}
        <a href="mailto:hello@tennisrankings.example">
          hello@tennisrankings.example
        </a>
        .
      </p>

      <h2>Where the data comes from</h2>
      <ul>
        <li>Weekly rankings: <a href="https://www.atptour.com/en/rankings">ATP</a> and <a href="https://www.wtatennis.com/rankings">WTA</a> official rankings.</li>
        <li>Player photos and bios: Wikipedia / Wikimedia Commons (CC BY-SA).</li>
        <li>Historical match data: Jeff Sackmann’s <a href="https://github.com/JeffSackmann/tennis_atp">tennis_atp</a> / <a href="https://github.com/JeffSackmann/tennis_wta">tennis_wta</a> datasets, used under their licence.</li>
      </ul>

      <p>
        Our scraper identifies itself politely, respects robots.txt, caps
        request rate to one per second, and refuses to publish a snapshot
        whose top-50 movement looks implausible. See the{" "}
        <a href="https://github.com/marco-marchesi/TennisRankings/blob/main/scraper/README.md">
          scraper README
        </a>{" "}
        for the rules.
      </p>

      <h2>How it stays independent</h2>
      <p>
        Optional Premium membership (no ads, full alerts, CSV exports) and
        sparingly placed display ads. We don't sell user data and we don't
        pretend that affiliate partners "endorse" anything.
      </p>
    </article>
  );
}
