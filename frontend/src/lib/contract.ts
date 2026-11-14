import type { Abi, Address } from 'viem'
// Copied verbatim from the forge build artifact
// (smart-contracts/out/Watcher.sol/Watcher.json -> .abi). Regenerate with:
//   jq '.abi' ../smart-contracts/out/Watcher.sol/Watcher.json > Watcher.abi.json
import watcherAbiJson from '../../Watcher.abi.json'

// Watcher V2.1 (multi-token ERC-20 vault) on Sepolia.
export const WATCHER_ADDRESS: Address = '0x5777D32B8Daf4624776CBBc1C7A0dD403Cd5cD8a'

// NOTE: cast to the wide `Abi` type, so wagmi does NOT type-check
// functionName/args against the real signatures — a call with the wrong
// argument list compiles fine and only fails at runtime.
// TODO(typed-abi): generate a typed `as const` ABI module (e.g. @wagmi/cli
// foundry plugin) so signature mismatches become compile errors. Deferred
// from the multi-token pass: it's a tooling change that would also force
// type fixes across the untouched Recovery/Containment tabs; every call's
// shape was verified against the ABI by hand instead.
export const watcherAbi = watcherAbiJson as Abi

export const watcherContract = {
  address: WATCHER_ADDRESS,
  abi: watcherAbi,
} as const
