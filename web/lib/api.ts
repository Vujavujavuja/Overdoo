/** Same-origin Next.js API routes — one deploy, no separate backend. */
export const API = "";

export interface Cover {
  coverEur: number;
  coverWei: string;
  premiumWei: string;
  premiumMon: number;
  coverMon: number;
}

export interface Offer {
  cover: Cover | null;
  flight: {
    flightKey: `0x${string}`;
    carrier: string;
    flightNumber: string;
    depAirport: string;
    arrAirport: string;
    scheduledArrival: string;
    actualArrival: string | null;
    distanceKm: number | null;
    consensus: {
      agreement: number;
      sources: string[];
      dissenting: string[];
      singleSource: boolean;
    };
    eligibility: {
      eligible: boolean;
      statutoryAmountEur: number;
      reason: string;
      delayMinutes: number | null;
      scopeBasis: string;
    };
    attested: boolean;
  };
  purchasable: boolean;
  blockers: string[];
  breakdown: {
    statutoryEur: number;
    recoveryProbability: number;
    expectedGrossEur: number;
    collectionCostEur: number;
    expectedNetEur: number;
    marginEur: number;
    purchasePriceEur: number;
  } | null;
  statutoryWei: string | null;
  purchaseWei: string | null;
  monPerEur: number;
}

export async function fetchOffer(carrier: string, flightNumber: string, date: string) {
  const r = await fetch(
    `/api/offer?carrier=${carrier}&flightNumber=${flightNumber}&date=${date}`,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "lookup failed");
  return j as Offer;
}

export async function prepareAssignment(body: {
  carrier: string;
  flightNumber: string;
  date: string;
  passengerAddress: string;
  passengerName: string;
}) {
  const r = await fetch(`${API}/api/claims/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "prepare failed");
  return j as {
    text: string;
    documentHash: `0x${string}`;
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, string>;
    };
  };
}

export async function acceptClaim(body: {
  carrier: string;
  flightNumber: string;
  date: string;
  passengerAddress: string;
  passengerName: string;
  signature: string;
}) {
  const r = await fetch(`${API}/api/claims/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "purchase failed");
  return j as {
    claimId: string;
    txHash: string;
    explorer: string;
    paidMon: string;
  };
}

/** "LH1107" -> { carrier: "LH", number: "1107" } */
export function parseFlight(input: string): { carrier: string; number: string } | null {
  const m = input.trim().toUpperCase().replace(/\s+/g, "").match(/^([A-Z0-9]{2})(\d{1,4})$/);
  return m ? { carrier: m[1], number: m[2] } : null;
}
