import { erc20Abi, type Address } from 'viem'
import { useReadContracts } from 'wagmi'
import { watcherContract } from './contract'
import { TOKENS, type Token, type TokenSlug } from './tokens'

export type TokenStatus = {
  token: Token
  decimals: number | undefined
  walletBalance: bigint | undefined
  vaultBalance: bigint | undefined
  hasPending: boolean | undefined
  // undefined while loading. "Inactive" = nothing in the wallet, nothing in
  // the vault AND no queued withdrawal — the last condition matters because
  // withdraw() deducts the vault balance the moment a withdrawal is queued,
  // so a fully-queued token would otherwise look empty and hide the Security
  // Queue (and its Cancel button) behind the "get started" state.
  isActive: boolean | undefined
}

// One batched read for every token's cross-cutting facts — used by the token
// tab bar (muted state), the /app auto-select, and each token tab itself, so
// they all agree on the same numbers.
export function useTokenOverview(user: Address | undefined) {
  // decimals() never changes — fetched once and cached for the session.
  const { data: decimalsData } = useReadContracts({
    contracts: TOKENS.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'decimals' }) as const),
    query: { staleTime: Infinity },
  })

  const {
    data: userData,
    isLoading,
    refetch,
  } = useReadContracts({
    contracts: user
      ? TOKENS.flatMap((t) => [
          { address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [user] } as const,
          { ...watcherContract, functionName: 'getUserVaultBalance', args: [user, t.address] } as const,
          { ...watcherContract, functionName: 'hasPendingWithdraw', args: [user, t.address] } as const,
        ])
      : [],
    query: { enabled: Boolean(user) },
  })

  const statuses = {} as Record<TokenSlug, TokenStatus>
  TOKENS.forEach((token, i) => {
    const decimals = decimalsData?.[i]?.result as number | undefined
    const walletBalance = userData?.[i * 3]?.result as bigint | undefined
    const vaultBalance = userData?.[i * 3 + 1]?.result as bigint | undefined
    const hasPending = userData?.[i * 3 + 2]?.result as boolean | undefined
    const loaded = walletBalance !== undefined && vaultBalance !== undefined && hasPending !== undefined
    statuses[token.slug] = {
      token,
      decimals,
      walletBalance,
      vaultBalance,
      hasPending,
      isActive: loaded ? walletBalance > 0n || vaultBalance > 0n || hasPending : undefined,
    }
  })

  return { statuses, isLoading, refetch }
}

// Fixed order WETH → USDC → WBTC, but a token with funds in the vault (or a
// queued withdrawal) beats one that only has a wallet balance. No activity
// anywhere → WETH, which then renders its "get started" state.
export function pickDefaultToken(statuses: Record<TokenSlug, TokenStatus>): TokenSlug {
  const inVault = TOKENS.find((t) => (statuses[t.slug].vaultBalance ?? 0n) > 0n || statuses[t.slug].hasPending)
  if (inVault) return inVault.slug
  const inWallet = TOKENS.find((t) => (statuses[t.slug].walletBalance ?? 0n) > 0n)
  return inWallet?.slug ?? TOKENS[0].slug
}
