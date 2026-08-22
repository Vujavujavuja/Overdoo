import { keccak256, toHex, verifyTypedData, type Address, type Hex } from 'viem';
import { addresses, monadTestnet } from './chain.js';

export const ASSIGNMENT_DOMAIN = {
  name: 'Aeroclaim',
  version: '1',
  chainId: monadTestnet.id,
  verifyingContract: addresses.Settlement as Address,
} as const;

export const ASSIGNMENT_TYPES = {
  ClaimAssignment: [
    { name: 'flightKey', type: 'bytes32' },
    { name: 'statutoryAmount', type: 'uint256' },
    { name: 'purchasePrice', type: 'uint256' },
    { name: 'documentHash', type: 'bytes32' },
  ],
} as const;

export interface AssignmentFacts {
  passengerName: string;
  passengerAddress: string;
  carrier: string;
  flightNumber: string;
  depAirport: string;
  arrAirport: string;
  flightDate: string;
  delayMinutes: number;
  statutoryEur: number;
  purchasePriceEur: number;
}

/**
 * The legal instrument. The chain stores only keccak256 of this text — the
 * assignment itself is a document, and pretending a bytes32 replaces it would
 * not survive contact with an airline's legal department.
 */
export function assignmentText(f: AssignmentFacts): string {
  return `ASSIGNMENT OF STATUTORY CLAIM
Regulation (EC) No 261/2004

ASSIGNOR:  ${f.passengerName}
           wallet ${f.passengerAddress}
ASSIGNEE:  Aeroclaim

FLIGHT:    ${f.carrier}${f.flightNumber} on ${f.flightDate}
ROUTE:     ${f.depAirport} to ${f.arrAirport}
DELAY:     ${f.delayMinutes} minutes at arrival

1. The Assignor assigns to the Assignee, absolutely and unconditionally, all
   rights, title and interest in any claim for compensation arising under
   Articles 5 and 7 of Regulation (EC) No 261/2004 in respect of the flight
   identified above, having a statutory value of EUR ${f.statutoryEur.toFixed(2)}.

2. In consideration the Assignee pays the Assignor EUR ${f.purchasePriceEur.toFixed(2)}
   immediately upon execution, settled on the Monad network. Payment is final
   and is not contingent on recovery from the operating carrier.

3. The Assignee bears the entire risk of non-recovery. The Assignor retains no
   liability if the operating carrier refuses, disputes or fails to pay.

4. The Assignor warrants that the claim has not been assigned, settled, or
   pursued elsewhere, and undertakes not to pursue it after execution.

5. The Assignor will, on request, provide the boarding pass or booking reference
   and sign any document reasonably required to give effect to this assignment.

6. This assignment is governed by the law of the Assignor's place of domicile
   within the European Union.

EXECUTED by electronic signature from wallet ${f.passengerAddress}.
The keccak256 hash of this text is recorded on Monad as the assignment reference.`;
}

export function documentHash(text: string): Hex {
  return keccak256(toHex(text));
}

export async function verifyAssignmentSignature(args: {
  passenger: Address;
  flightKey: Hex;
  statutoryAmount: bigint;
  purchasePrice: bigint;
  documentHash: Hex;
  signature: Hex;
}): Promise<boolean> {
  return verifyTypedData({
    address: args.passenger,
    domain: ASSIGNMENT_DOMAIN,
    types: ASSIGNMENT_TYPES,
    primaryType: 'ClaimAssignment',
    message: {
      flightKey: args.flightKey,
      statutoryAmount: args.statutoryAmount,
      purchasePrice: args.purchasePrice,
      documentHash: args.documentHash,
    },
    signature: args.signature,
  });
}
