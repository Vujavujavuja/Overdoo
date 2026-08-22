import { NextResponse } from "next/server";
import { resolveFlight, providers } from "@/lib/flight/consensus";
import { assessEligibility, adjustRunwayToGate } from "@/lib/flight/eligibility";
import { distanceBetween } from "@/lib/flight/airports";
import { priceClaim } from "@/lib/flight/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const carrier = (url.searchParams.get("carrier") ?? "").toUpperCase();
  const flightNumber = url.searchParams.get("flightNumber") ?? "";
  const date = url.searchParams.get("date") ?? "";

  if (!carrier || !flightNumber || !date) {
    return NextResponse.json(
      { error: "carrier, flightNumber and date are required" },
      { status: 400 },
    );
  }

  // Refuse to run without live flight data. There is no synthetic fallback:
  // inventing flight outcomes and quoting money against them is worse than
  // returning an error.
  if (providers().length === 0) {
    return NextResponse.json(
      { error: "No flight data provider configured. Set AERODATABOX_KEY and/or AVIATIONSTACK_KEY." },
      { status: 503 },
    );
  }

  try {
    const consensus = await resolveFlight(carrier, flightNumber, date);
    if (!consensus.status) {
      const detail = consensus.errors.map((e) => `${e.provider}: ${e.error}`).join("; ");
      return NextResponse.json(
        { error: `No provider could resolve ${carrier}${flightNumber} on ${date}. ${detail}` },
        { status: 404 },
      );
    }

    const s = consensus.status;
    const distanceKm = distanceBetween(s.depAirport, s.arrAirport);

    // EU261 measures arrival at door-open (Germanwings C-452/13). When only
    // runway time exists we add taxi-in and flag the figure as approximate.
    const arrival = s.actualArrival
      ? s.arrivalIsRunwayTime
        ? adjustRunwayToGate(s.actualArrival)
        : s.actualArrival
      : null;

    const eligibility = assessEligibility({
      carrier,
      depAirport: s.depAirport,
      arrAirport: s.arrAirport,
      scheduledArrival: s.scheduledArrival,
      actualArrival: arrival,
      kind: s.status === "cancelled" ? "cancellation" : "delay",
      cancellationNoticeDays: 0,
      arrivalTimeApproximate: s.arrivalIsRunwayTime,
    });

    const breakdown = eligibility.eligible
      ? priceClaim(eligibility.statutoryAmountEur)
      : null;

    const blockers: string[] = [];
    if (!eligibility.eligible) blockers.push(eligibility.reason);
    if (consensus.agreement < 2) {
      blockers.push(
        consensus.agreement === 1
          ? `Single-source data (${consensus.sources[0]}). A second provider must confirm before purchase.`
          : "No provider has confirmed an actual arrival time yet.",
      );
    }

    return NextResponse.json({
      flight: {
        carrier,
        flightNumber,
        depAirport: s.depAirport,
        arrAirport: s.arrAirport,
        scheduledArrival: s.scheduledArrival.toISOString(),
        actualArrival: arrival?.toISOString() ?? null,
        distanceKm,
        consensus: {
          agreement: consensus.agreement,
          sources: consensus.sources,
          dissenting: consensus.dissenting,
          singleSource: consensus.agreement === 1,
          rawHashes: consensus.rawHashes,
        },
        eligibility,
      },
      purchasable: blockers.length === 0 && breakdown !== null,
      blockers,
      breakdown,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
