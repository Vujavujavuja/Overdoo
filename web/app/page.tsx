"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { fetchOffer, parseFlight, type Offer } from "@/lib/api";

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export default function Home() {
  const [flight, setFlight] = useState("");
  const [date, setDate] = useState(yesterday());
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    const parsed = parseFlight(flight);
    if (!parsed) {
      setError("Enter a flight number like IB468");
      return;
    }
    setError(null);
    setOffer(null);
    setLoading(true);
    try {
      setOffer(await fetchOffer(parsed.carrier, parsed.number, date));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const e = offer?.flight.eligibility;
  const c = offer?.flight.consensus;
  const b = offer?.breakdown;

  return (
    <main className="mx-auto w-full max-w-md px-8 py-24">
      <h1 className="font-[family-name:var(--font-serif)] text-5xl italic tracking-tight">
        Overdoo
      </h1>

      <div className="mt-14">
        <Input
          label="Flight number"
          value={flight}
          onChange={(ev) => setFlight(ev.target.value)}
          onKeyDown={(ev) => ev.key === "Enter" && check()}
        />

        <input
          type="date"
          value={date}
          onChange={(ev) => setDate(ev.target.value)}
          className="mt-8 w-full border-b border-black/25 bg-transparent py-2 text-base text-black outline-none focus:border-black"
        />

        <button
          onClick={check}
          disabled={loading}
          className="group mt-10 flex items-center gap-3 text-base text-black disabled:opacity-30"
        >
          <span className="transition-transform group-hover:translate-x-1">&#8594;</span>
          <span>{loading ? "checking" : "check"}</span>
        </button>
      </div>

      {error && <p className="mt-10 text-base text-black/50">{error}</p>}

      {offer && e && c && (
        <section className="mt-16 space-y-6 text-base">
          <p className="text-black/45">
            {offer.flight.depAirport} to {offer.flight.arrAirport}
            {offer.flight.distanceKm
              ? `, ${Math.round(offer.flight.distanceKm)} kilometres`
              : ""}
            {e.delayMinutes !== null ? `, ${e.delayMinutes} minutes late` : ""}.
          </p>

          {e.eligible ? (
            <>
              <p className="text-3xl">You are owed &euro;{e.statutoryAmountEur}.</p>
              {b && (
                <p>
                  We will pay you{" "}
                  <span className="font-semibold">
                    &euro;{b.purchasePriceEur}
                  </span>{" "}
                  today, and take the airline on ourselves.
                </p>
              )}
            </>
          ) : (
            <p className="text-3xl">Nothing owed.</p>
          )}

          <p className="text-black/45">{e.reason}</p>

          <p className="text-black/35">
            Confirmed by {c.agreement} of {c.sources.length + c.dissenting.length} sources
            {c.sources.length ? ` (${c.sources.join(", ")})` : ""}.
            {c.singleSource && " A second source is needed before we can pay."}
          </p>

          {b && (
            <p className="text-black/35">
              &euro;{b.statutoryEur} statutory, {Math.round(b.recoveryProbability * 100)}%
              chance we recover it, less &euro;{b.collectionCostEur} to chase and &euro;
              {b.marginEur} for us. That leaves you &euro;{b.purchasePriceEur}.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
