---
title: "Why ATP ranking points expire — and how to read the projection"
slug: "points-expiry"
description: "Points fall off the ranking 52 weeks after they were won. Here's why that produces big movements without anyone playing, and how to read our projection table."
author: "Marco Marchesi"
publishedAt: "2026-05-20"
updatedAt: "2026-05-20"
readingMinutes: 4
---

# Why ATP ranking points expire

The ATP ranking is a **rolling 52-week average**, not a season total. The
phrase "rolling" is doing a lot of work. Imagine a 52-week window sliding
forward by exactly seven days every Monday morning. Anything inside the
window counts; anything that falls out doesn't.

That's how a player can drop ten ranks **without playing a match**.

## A worked example

Take Carlos Alcaraz at Roland Garros 2024 (won, +2,000 points). For
51 weeks, those 2,000 points stay in his ranking.

The Monday **before** Roland Garros 2025, those 2,000 points hit the end
of the window and drop off. From that moment on, his ranking is
recomputed without them.

Whatever he does at Roland Garros 2025 *replaces* the expiring total:

- If he wins again: net change = 0.
- If he reaches the semi-final: 800 in, 2,000 out → −1,200 net.
- If he loses in round one: 10 in, 2,000 out → −1,990 net.

Now consider that this is happening in parallel for 18 different
tournaments per player, and you start to see why the live-rankings page is
never a static document. It is the sum of 18 expiry timers, all ticking.

## How to read our projection table

Our [ranking projection page](/rankings/projection) shows you which
players are about to lose the most points and where they will sit once
those points drop off.

Each row contains five numbers worth understanding:

| Column | Meaning |
|---|---|
| **Now** | The player's current rank. |
| **→** | Where they will rank in 4 weeks if results don't change. Green = up, red = down. |
| **Current pts** | Their current total. |
| **Expiring** | Points falling off the rolling window in the next 4 weeks. |
| **Projected** | Current minus expiring. The new total they start the next ranking week with. |
| **Δ** | The change in rank between Now and Projected. |

A player who is **leading** the projection table with a large Δ is
defending nothing — every match they play just adds. A player **falling**
with a large Δ is defending a major result and is, statistically, the
biggest mover to watch.

## Common misreadings

**"His ranking went down even though he won."** Yes — that's possible if
the points he was defending exceed the points he just earned. Net change
matters; the result alone doesn't.

**"She's number one in the Race but not in the Live Ranking."** The Race
is calendar-year. The Live Ranking is 52-week rolling. They diverge in
the first half of the year and converge near the Finals.

**"His projection says rank 12, but he could still drop further."** Correct.
The projection assumes future tournaments produce zero points. If the
player has a bad result, the actual drop will be larger.

---

*Want this calculated for your favourite player? Sign in and follow them
— we'll email when their projection changes by more than three places.*
