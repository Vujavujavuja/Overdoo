"use client";

import { useState } from "react";
import { formatEther } from "viem";
import {
  useConnect,
  useConnection,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Input } from "@/components/ui/input";
import { fetchOffer, parseFlight, type Offer } from "@/lib/api";
import { decodeEventLog } from "viem";
import { delayCoverAbi } from "@/lib/delayCoverAbi";
import { DELAY_COVER_ADDRESS } from "@/lib/flight/cover";
import { monad } from "@/lib/wagmi";

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

export default function Home() {
  const [flight, setFlight] = useState("");
  const [date, setDate] = useState(yesterday());
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<bigint | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [payout, setPayout] = useState<{
    paidOut: boolean;
    payoutMon: number;
    delayMinutes: number;
    explorer: string;
  } | null>(null);

  const { address, isConnected, chainId } = useConnection();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  const wrongChain = isConnected && chainId !== monad.id;

  async function check() {
    const parsed = parseFlight(flight);
    if (!parsed) {
      setError("Enter a flight number like IB468");
      return;
    }
    setError(null);
    setOffer(null);
    setPolicyId(null);
    setPayout(null);
    reset();
    setLoading(true);
    try {
      setOffer(await fetchOffer(parsed.carrier, parsed.number, date));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function insure() {
    if (!offer?.cover) return;
    writeContract({
      address: DELAY_COVER_ADDRESS,
      abi: delayCoverAbi,
      functionName: "buy",
      args: [offer.flight.flightKey, BigInt(offer.cover.coverWei)],
      value: BigInt(offer.cover.premiumWei),
    });
  }

  if (receipt.isSuccess && policyId === null && receipt.data) {
    for (const log of receipt.data.logs) {
      try {
        const parsed = decodeEventLog({
          abi: delayCoverAbi,
          data: log.data,
          topics: log.topics,
        });
        if (parsed.eventName === "PolicyBought") {
          setPolicyId((parsed.args as { id: bigint }).id);
          break;
        }
      } catch {
        /* not our event */
      }
    }
  }

  async function claim() {
    const parsed = parseFlight(flight);
    if (!parsed || policyId === null) return;
    setClaiming(true);
    setError(null);
    try {
      const r = await fetch("/api/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: parsed.carrier,
          flightNumber: parsed.number,
          date,
          policyId: policyId.toString(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "settlement failed");
      setPayout(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  const e = offer?.flight.eligibility;
  const c = offer?.flight.consensus;
  const cover = offer?.cover;
  const busy = isPending || receipt.isLoading;

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
            <p className="text-3xl">You are owed &euro;{e.statutoryAmountEur}.</p>
          ) : (
            <p className="text-3xl">Nothing owed.</p>
          )}

          <p className="text-black/45">{e.reason}</p>

          {cover && (
            <div className="space-y-4 border-t border-black/10 pt-6">
              <p>
                Cover this flight for &euro;{cover.coverEur}. If it lands three hours
                late, you are paid automatically.
              </p>
              <p className="text-black/45">
                Premium {cover.premiumMon.toFixed(6)} MON, pays out{" "}
                {cover.coverMon.toFixed(4)} MON.
              </p>

              {payout ? (
                <div className="space-y-2">
                  <p className="text-3xl">
                    {payout.paidOut
                      ? `Paid out ${payout.payoutMon.toFixed(4)} MON.`
                      : "No payout: under three hours."}
                  </p>
                  <p className="text-black/45">
                    Landed {payout.delayMinutes} minutes late.{" "}
                    <a
                      href={payout.explorer}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      view transaction
                    </a>
                  </p>
                </div>
              ) : receipt.isSuccess ? (
                <div className="space-y-4">
                  <p>
                    Covered.{" "}
                    <a
                      href={`https://testnet.monadvision.com/tx/${hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      view transaction
                    </a>
                  </p>
                  <button
                    onClick={claim}
                    disabled={claiming || policyId === null}
                    className="group flex items-center gap-3 text-base disabled:opacity-30"
                  >
                    <span className="transition-transform group-hover:translate-x-1">
                      &#8594;
                    </span>
                    <span>{claiming ? "settling on chain" : "claim payout"}</span>
                  </button>
                </div>
              ) : !isConnected ? (
                <button
                  onClick={() => connect({ connector: connectors[0] })}
                  className="group flex items-center gap-3 text-base"
                >
                  <span className="transition-transform group-hover:translate-x-1">
                    &#8594;
                  </span>
                  <span>connect wallet</span>
                </button>
              ) : wrongChain ? (
                <button
                  onClick={() => switchChain({ chainId: monad.id })}
                  className="group flex items-center gap-3 text-base"
                >
                  <span className="transition-transform group-hover:translate-x-1">
                    &#8594;
                  </span>
                  <span>switch to Monad testnet</span>
                </button>
              ) : (
                <button
                  onClick={insure}
                  disabled={busy}
                  className="group flex items-center gap-3 text-base disabled:opacity-30"
                >
                  <span className="transition-transform group-hover:translate-x-1">
                    &#8594;
                  </span>
                  <span>
                    {isPending
                      ? "confirm in wallet"
                      : receipt.isLoading
                        ? "paying"
                        : `pay ${cover.premiumMon.toFixed(6)} MON`}
                  </span>
                </button>
              )}

              {writeError && (
                <p className="text-black/50">{writeError.message.split("\n")[0]}</p>
              )}
              {address && (
                <p className="text-black/30">
                  {address.slice(0, 6)}&hellip;{address.slice(-4)}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
