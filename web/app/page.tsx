"use client";

import { useState } from "react";
import { decodeEventLog } from "viem";
import {
  useConnect,
  useConnection,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Input } from "@/components/ui/input";
import { fetchOffer, parseFlight, type Offer } from "@/lib/api";
import { delayCoverAbi } from "@/lib/delayCoverAbi";
import { DELAY_COVER_ADDRESS } from "@/lib/flight/cover";
import { monad } from "@/lib/wagmi";

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** Arrow + label. No button chrome anywhere. */
function Action({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-3 text-base text-black disabled:opacity-30"
    >
      <span className="transition-transform group-hover:translate-x-1">&#8594;</span>
      <span>{children}</span>
    </button>
  );
}

/**
 * Contract reverts surface as a wall of viem output. Map the ones a user can
 * actually hit to something they can act on — "AlreadyCovered" in particular is
 * correct behaviour, not a failure, and should not read like a crash.
 */
function humanError(message: string): string {
  if (message.includes("InsufficientReserves"))
    return "The underwriting reserve cannot cover this policy right now. Try a shorter route, or top up the contract.";
  if (message.includes("Underpaid"))
    return "Premium did not match the quote. Refresh and get a new quote.";
  if (message.includes("User rejected") || message.includes("denied"))
    return "You rejected the transaction in your wallet.";
  if (message.includes("insufficient funds"))
    return "Not enough MON in this wallet to pay the premium plus gas.";
  return message.split("\n")[0];
}

export default function Home() {
  const [flight, setFlight] = useState("");
  const [date, setDate] = useState(yesterday());

  const [quote, setQuote] = useState<Offer | null>(null);
  const [quoting, setQuoting] = useState(false);

  const [policyId, setPolicyId] = useState<bigint | null>(null);

  // The delay result is deliberately withheld until after cover is bought —
  // knowing the outcome first is exactly what makes insurance unsellable.
  const [checked, setChecked] = useState<Offer | null>(null);
  const [checking, setChecking] = useState(false);

  const [payout, setPayout] = useState<{
    paidOut: boolean;
    payoutMon: number;
    delayMinutes: number;
    explorer: string;
  } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isConnected, chainId } = useConnection();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });

  const wrongChain = isConnected && chainId !== monad.id;

  async function getQuote() {
    const parsed = parseFlight(flight);
    if (!parsed) {
      setError("Enter a flight number like FR7392");
      return;
    }
    setError(null);
    setQuote(null);
    setChecked(null);
    setPayout(null);
    setPolicyId(null);
    reset();
    setQuoting(true);
    try {
      setQuote(await fetchOffer(parsed.carrier, parsed.number, date));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQuoting(false);
    }
  }

  function pay() {
    if (!quote?.cover) return;
    writeContract({
      address: DELAY_COVER_ADDRESS,
      abi: delayCoverAbi,
      functionName: "buy",
      args: [quote.flight.flightKey, BigInt(quote.cover.coverWei)],
      value: BigInt(quote.cover.premiumWei),
    });
  }

  async function runCheck() {
    const parsed = parseFlight(flight);
    if (!parsed) return;
    setChecking(true);
    setError(null);
    try {
      setChecked(await fetchOffer(parsed.carrier, parsed.number, date));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
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

  if (receipt.isSuccess && policyId === null && receipt.data) {
    for (const log of receipt.data.logs) {
      try {
        const parsed = decodeEventLog({ abi: delayCoverAbi, data: log.data, topics: log.topics });
        if (parsed.eventName === "PolicyBought") {
          setPolicyId((parsed.args as { id: bigint }).id);
          break;
        }
      } catch {
        /* not our event */
      }
    }
  }

  const cover = quote?.cover;
  const covered = receipt.isSuccess;
  const busy = isPending || receipt.isLoading;
  const result = checked?.flight.eligibility;

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
          onKeyDown={(ev) => ev.key === "Enter" && getQuote()}
          disabled={covered}
        />
        <input
          type="date"
          value={date}
          onChange={(ev) => setDate(ev.target.value)}
          disabled={covered}
          className="mt-8 w-full border-b border-black/25 bg-transparent py-2 text-base text-black outline-none focus:border-black disabled:opacity-50"
        />

        {!quote && (
          <div className="mt-10">
            <Action onClick={getQuote} disabled={quoting}>
              {quoting ? "pricing" : "get a quote"}
            </Action>
          </div>
        )}
      </div>

      {error && <p className="mt-10 text-base text-black/50">{error}</p>}

      {/* ---- quote: route and price only. No delay information yet. ---- */}
      {quote && cover && (
        <section className="mt-16 space-y-6 text-base">
          <p className="text-black/45">
            {quote.flight.depAirport} to {quote.flight.arrAirport}
            {quote.flight.distanceKm
              ? `, ${Math.round(quote.flight.distanceKm)} kilometres`
              : ""}
            .
          </p>

          <p className="text-3xl">Cover &euro;{cover.coverEur}.</p>
          <p className="text-black/45">
            Premium {cover.premiumMon.toFixed(6)} MON. If the flight lands three hours
            late you are paid {cover.coverMon.toFixed(4)} MON, whatever the airline says.
          </p>

          {!covered ? (
            !isConnected ? (
              <Action onClick={() => connect({ connector: connectors[0] })}>
                connect wallet
              </Action>
            ) : wrongChain ? (
              <Action onClick={() => switchChain({ chainId: monad.id })}>
                switch to Monad testnet
              </Action>
            ) : (
              <Action onClick={pay} disabled={busy}>
                {isPending
                  ? "confirm in wallet"
                  : receipt.isLoading
                    ? "paying"
                    : `pay ${cover.premiumMon.toFixed(6)} MON`}
              </Action>
            )
          ) : (
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
          )}

          {writeError && (
            <p className="text-black/50">{humanError(writeError.message)}</p>
          )}
        </section>
      )}

      {/* ---- after cover: only now do we look at what the flight did ---- */}
      {covered && (
        <section className="mt-14 space-y-6 border-t border-black/10 pt-10 text-base">
          {!checked ? (
            <>
              <p className="text-black/45">
                Your flight is covered. Check it when you land.
              </p>
              <Action onClick={runCheck} disabled={checking}>
                {checking ? "checking flight" : "check my flight"}
              </Action>
            </>
          ) : (
            <>
              <p className="text-black/45">
                Landed {result?.delayMinutes ?? 0} minutes late.
              </p>

              {result?.eligible ? (
                <>
                  <p className="text-3xl">You are owed &euro;{result.statutoryAmountEur}.</p>
                  <p className="text-black/45">{result.reason}</p>
                  {payout ? (
                    <p className="text-3xl">
                      {payout.paidOut
                        ? `Paid ${payout.payoutMon.toFixed(4)} MON.`
                        : "No payout."}{" "}
                      <a
                        href={payout.explorer}
                        target="_blank"
                        rel="noreferrer"
                        className="text-base underline"
                      >
                        view transaction
                      </a>
                    </p>
                  ) : (
                    <Action onClick={claim} disabled={claiming || policyId === null}>
                      {claiming ? "settling on chain" : "collect payout"}
                    </Action>
                  )}
                </>
              ) : (
                <>
                  <p className="text-3xl">On time. Nothing owed.</p>
                  <p className="text-black/45">{result?.reason}</p>
                  {!payout && (
                    <Action onClick={claim} disabled={claiming || policyId === null}>
                      {claiming ? "closing policy" : "close policy"}
                    </Action>
                  )}
                  {payout && <p className="text-black/45">Policy closed, no payout.</p>}
                </>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
