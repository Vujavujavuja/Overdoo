"use client";

import { useEffect, useState } from "react";
import { formatEther, parseEther } from "viem";
import {
  useBalance,
  useConnect,
  useConnection,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import { tipJarAbi, TIPJAR_ADDRESS } from "@/lib/contract";
import { monad } from "@/lib/wagmi";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const PRICE = parseEther("0.01");

const jar = { address: TIPJAR_ADDRESS ?? ZERO, abi: tipJarAbi } as const;
const deployed = Boolean(TIPJAR_ADDRESS);

type FeedItem = { key: string; who: string; amount: string };

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const mon = (v?: bigint) =>
  v === undefined ? "—" : Number(formatEther(v)).toFixed(3);

export default function Home() {
  // wagmi + SSR: don't render wallet state until mounted or hydration mismatches.
  const [mounted, setMounted] = useState(false);
  const [hasWallet, setHasWallet] = useState(true);
  useEffect(() => {
    setMounted(true);
    setHasWallet(
      typeof window !== "undefined" &&
        Boolean((window as { ethereum?: unknown }).ethereum),
    );
  }, []);

  const { address, isConnected, chainId } = useConnection();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== monad.id;

  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  const owner = useReadContract({
    ...jar,
    functionName: "owner",
    query: { enabled: deployed },
  });
  const tips = useReadContract({
    ...jar,
    functionName: "totalTips",
    query: { enabled: deployed },
  });
  const received = useReadContract({
    ...jar,
    functionName: "totalReceived",
    query: { enabled: deployed },
  });
  const people = useReadContract({
    ...jar,
    functionName: "tipperCount",
    query: { enabled: deployed },
  });
  const mine = useReadContract({
    ...jar,
    functionName: "tipsOf",
    args: [address ?? ZERO],
    query: { enabled: deployed && Boolean(address) },
  });

  const isOwner =
    Boolean(address) &&
    owner.data?.toLowerCase() === address?.toLowerCase();

  // --- pay + latency -------------------------------------------------------
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const {
    writeContract,
    data: hash,
    isPending: signing,
    error: writeError,
    reset,
  } = useWriteContract({
    // Fires when the tx is broadcast, i.e. after signing — so this measures
    // chain time, not how long you took to click Confirm.
    mutation: { onSuccess: () => setSentAt(performance.now()) },
  });

  const receipt = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (!receipt.isSuccess) return;
    if (sentAt !== null) {
      setLatency(Math.round(performance.now() - sentAt));
      setSentAt(null);
    }
    tips.refetch();
    received.refetch();
    people.refetch();
    mine.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  // --- live feed -----------------------------------------------------------
  const [feed, setFeed] = useState<FeedItem[]>([]);

  useWatchContractEvent({
    ...jar,
    eventName: "Tipped",
    enabled: deployed,
    onLogs: (logs) =>
      setFeed((f) =>
        [
          ...logs.map((l, i) => ({
            key: `${l.transactionHash}-${l.logIndex}-${i}`,
            who: short(l.args.from),
            amount: mon(l.args.amount),
          })),
          ...f,
        ].slice(0, 12),
      ),
  });

  const busy = signing || receipt.isLoading;
  const pay = () => {
    setLatency(null);
    reset();
    writeContract({ ...jar, functionName: "tip", value: PRICE });
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12 font-mono">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#836EF9]">
            Tip Jar
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Monad Testnet · chain {monad.id}
          </p>
        </div>

        {mounted && (
          <div className="text-right">
            {isConnected ? (
              <>
                <div className="text-sm text-zinc-300">{short(address)}</div>
                <div className="text-xs text-zinc-500">
                  {balance ? `${mon(balance.value)} MON` : "…"}
                </div>
                <button
                  onClick={() => disconnect()}
                  className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-400"
                >
                  disconnect
                </button>
              </>
            ) : (
              <button
                onClick={() => connect({ connector: connectors[0] })}
                disabled={connecting || !connectors[0] || !hasWallet}
                className="rounded-md bg-[#836EF9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6f5ae0] disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
          </div>
        )}
      </header>

      {mounted && !hasWallet && !isConnected && (
        <Banner tone="warn">
          No wallet extension detected. Install MetaMask, then <b>hard-refresh</b>{" "}
          this page (⌘⇧R) — extensions only inject themselves on page load.
        </Banner>
      )}

      {!deployed && (
        <Banner tone="warn">
          No contract address set. Deploy, then put the printed address in{" "}
          <code className="text-zinc-300">web/.env.local</code> as{" "}
          <code className="text-zinc-300">NEXT_PUBLIC_TIPJAR_ADDRESS</code> and
          restart the dev server.
        </Banner>
      )}

      {mounted && wrongChain && (
        <Banner tone="warn">
          Wrong network.{" "}
          <button
            onClick={() => switchChain({ chainId: monad.id })}
            className="underline hover:text-white"
          >
            Switch to Monad Testnet
          </button>
        </Banner>
      )}

      {mounted && isOwner && (
        <Banner tone="info">
          This is your jar — every tip lands straight in your wallet. Watch the
          balance above go up.
        </Banner>
      )}

      <section className="mb-8 grid grid-cols-3 gap-3">
        <Stat label="MON received" value={mon(received.data)} big />
        <Stat label="tips" value={tips.data?.toString() ?? "—"} />
        <Stat label="payers" value={people.data?.toString() ?? "—"} />
      </section>

      <button
        onClick={pay}
        disabled={!mounted || !isConnected || wrongChain || !deployed || busy}
        className="mb-3 w-full rounded-lg bg-[#836EF9] py-5 text-lg font-bold text-white transition hover:bg-[#6f5ae0] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {signing
          ? "Confirm in wallet…"
          : receipt.isLoading
            ? "Sending…"
            : "PAY 0.01 MON"}
      </button>

      <p className="mb-8 text-center text-xs text-zinc-600">
        {mine.data !== undefined && mine.data > BigInt(0)
          ? `you've paid ${mine.data.toString()}×`
          : "goes straight to the owner's wallet"}
      </p>

      {latency !== null && (
        <div className="mb-6 rounded-lg border border-[#836EF9]/40 bg-[#836EF9]/10 px-4 py-3">
          <span className="text-2xl font-bold text-[#836EF9]">{latency}ms</span>
          <span className="ml-2 text-sm text-zinc-400">broadcast → confirmed</span>
          {hash && (
            <a
              href={`${monad.blockExplorers.default.url}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="ml-3 text-xs text-zinc-500 underline hover:text-zinc-300"
            >
              view tx
            </a>
          )}
        </div>
      )}

      {writeError && (
        <Banner tone="error">{writeError.message.split("\n")[0]}</Banner>
      )}

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-widest text-zinc-600">
          live payments
        </h2>
        {feed.length === 0 ? (
          <p className="text-sm text-zinc-700">
            Nothing yet — payments appear here the moment they land on-chain.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {feed.map((f) => (
              <li key={f.key} className="flex gap-3 text-zinc-400">
                <span className="text-[#836EF9]">{f.who}</span>
                <span>paid {f.amount} MON</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-zinc-600">
        {label}
      </div>
      <div
        className={`mt-1 font-bold ${big ? "text-3xl text-[#836EF9]" : "text-xl text-zinc-200"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warn" | "error" | "info";
  children: React.ReactNode;
}) {
  const c =
    tone === "error"
      ? "border-red-900/60 bg-red-950/30 text-red-300"
      : tone === "info"
        ? "border-[#836EF9]/40 bg-[#836EF9]/10 text-zinc-300"
        : "border-amber-900/60 bg-amber-950/20 text-amber-200";
  return (
    <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${c}`}>
      {children}
    </div>
  );
}
