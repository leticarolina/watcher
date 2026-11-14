import { parseAbi, type Address } from 'viem'

// The tokens allowlisted on the Sepolia Watcher deployment — must mirror
// smart-contracts/script/DeployWatcher.s.sol (WETH, USDC, WBTC). Order here is
// the tab order and the auto-select priority order.
//
// Decimals are deliberately NOT hardcoded: they're read from each token's
// decimals() on-chain (see useTokenOverview) so a test token that deviates
// from mainnet conventions can't silently mis-scale amounts.
export const TOKENS = [
  { slug: 'weth', symbol: 'WETH', address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', wrapsNative: true },
  { slug: 'usdc', symbol: 'USDC', address: '0xf08A50178dfcDe18524640EA6618a1f965821715', wrapsNative: false },
  { slug: 'wbtc', symbol: 'WBTC', address: '0x92f3B59a79bFf5dc60c0d59eA13a44D082B2bdFC', wrapsNative: false },
] as const satisfies readonly { slug: string; symbol: string; address: Address; wrapsNative: boolean }[]

export type Token = (typeof TOKENS)[number]
export type TokenSlug = Token['slug']

// WETH9's payable deposit(): send ETH as msg.value, receive the same amount
// of WETH. Only used for tokens with wrapsNative: true. (The vault itself
// rejects native ETH — receive()/fallback() revert with UseWETH() — so ETH
// has to be wrapped client-side before it can be deposited.)
export const wethAbi = parseAbi(['function deposit() payable'])
