import type { Abi, Address } from 'viem'
import watcherAbiJson from '../../Watcher.abi.json'

// export const WATCHER_ADDRESS: Address = '0xB0c7a97cEE61d3Da05e2cF4Fb704e44d2bdFc230'
export const WATCHER_ADDRESS: Address = '0x4dB4243Fd93e328C5568B3521d27C2c927733CDb'

export const watcherAbi = watcherAbiJson as Abi

export const watcherContract = {
  address: WATCHER_ADDRESS,
  abi: watcherAbi,
} as const
