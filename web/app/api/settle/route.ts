import { NextResponse } from "next/server";
import { resolveFlight } from "@/lib/flight/consensus";
import { adjustRunwayToGate } from "@/lib/flight/eligibility";
import { distanceBetween } from "@/lib/flight/airports";
import {
  ATTESTATION_TYPES,
  FLIGHT_ORACLE,
  attestorAccount,
  domain,
  flightKeyHash,
  opsWallet,
  publicClient,
} from "@/lib/flight/chain";
import { flightOracleAbi } from "@/lib/flightOracleAbi";
import { delayCoverAbi } from "@/lib/delayCoverAbi";
import { DELAY_COVER_ADDRESS } from "@/lib/flight/cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusCode(phase: string): number {
  if (phase === "cancelled") return 2;
  if (phase === "diverted") return 3;
  if (phase === "landed" || phase === "active") return 1;
  return 0;
}

/**
 * Attest the flight on chain (if it isn't already) and settle the policy.
 * Settlement is public on the contract, but attestation needs the attestor key,
 * so both run here.
 */
export async function POST(req: Request) {
  try {
    const { carrier, flightNumber, date, policyId } = await req.json();
    if (!carrier || !flightNumber || !date || policyId === undefined) {
      return NextResponse.json({ error: "missing fields" }, { status: 400 });
    }

    const consensus = await resolveFlight(carrier.toUpperCase(), String(flightNumber), date);
    const s = consensus.status;
    if (!s?.actualArrival) {
      return NextResponse.json(
        { error: "Flight has not arrived yet, or no provider reports an arrival time." },
        { status: 409 },
      );
    }

    const arrival = s.arrivalIsRunwayTime ? adjustRunwayToGate(s.actualArrival) : s.actualArrival;
    const flightKey = flightKeyHash(carrier, String(flightNumber), s.scheduledDeparture);
    const distanceKm = distanceBetween(s.depAirport, s.arrAirport) ?? 0;
    const delayMinutes = Math.max(
      0,
      Math.round((arrival.getTime() - s.scheduledArrival.getTime()) / 60000),
    );

    const wallet = opsWallet();
    const already = (await publicClient.readContract({
      address: FLIGHT_ORACLE,
      abi: flightOracleAbi,
      functionName: "isAttested",
      args: [flightKey],
    })) as boolean;

    let attestTx: string | null = null;
    if (!already) {
      const message = {
        flightKey,
        scheduledArrival: BigInt(Math.floor(s.scheduledArrival.getTime() / 1000)),
        actualArrival: BigInt(Math.floor(arrival.getTime() / 1000)),
        delayMinutes,
        status: statusCode(s.status),
        distanceKm: Math.round(distanceKm),
        attestedAt: BigInt(Math.floor(Date.now() / 1000)),
      };

      const signature = await attestorAccount().signTypedData({
        domain: domain(),
        types: ATTESTATION_TYPES,
        primaryType: "Attestation",
        message,
      });

      const hash = await wallet.writeContract({
        address: FLIGHT_ORACLE,
        abi: flightOracleAbi,
        functionName: "attest",
        args: [message, [signature]],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      attestTx = hash;
    }

    const settleHash = await wallet.writeContract({
      address: DELAY_COVER_ADDRESS,
      abi: delayCoverAbi,
      functionName: "settle",
      args: [BigInt(policyId)],
    });
    await publicClient.waitForTransactionReceipt({ hash: settleHash });

    const policy = (await publicClient.readContract({
      address: DELAY_COVER_ADDRESS,
      abi: delayCoverAbi,
      functionName: "getPolicy",
      args: [BigInt(policyId)],
    })) as { paidOut: boolean; cover: bigint };

    return NextResponse.json({
      delayMinutes,
      paidOut: policy.paidOut,
      payoutMon: Number(policy.cover) / 1e18,
      attestTx,
      settleTx: settleHash,
      explorer: `https://testnet.monadvision.com/tx/${settleHash}`,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
