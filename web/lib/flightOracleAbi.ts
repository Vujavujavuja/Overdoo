export const flightOracleAbi = [
  {
    type: "function",
    name: "isAttested",
    inputs: [{ name: "flightKey", type: "bytes32" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "attest",
    inputs: [
      {
        name: "a",
        type: "tuple",
        components: [
          { name: "flightKey", type: "bytes32" },
          { name: "scheduledArrival", type: "uint64" },
          { name: "actualArrival", type: "uint64" },
          { name: "delayMinutes", type: "uint32" },
          { name: "status", type: "uint8" },
          { name: "distanceKm", type: "uint32" },
          { name: "attestedAt", type: "uint64" },
        ],
      },
      { name: "sigs", type: "bytes[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
