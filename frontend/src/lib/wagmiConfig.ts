import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'viem'
import { sepolia } from 'wagmi/chains'

// Public fallback so the app still works with zero env config.
// Rate-limited — set VITE_SEPOLIA_RPC_URL for anything beyond local dev.
const PUBLIC_SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'

const sepoliaRpcUrl = import.meta.env.VITE_SEPOLIA_RPC_URL || PUBLIC_SEPOLIA_RPC_URL

// Sepolia only — wagmi's built-in chain export, chain id 11155111.
export const wagmiConfig = getDefaultConfig({
  appName: 'Watcher',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(sepoliaRpcUrl),
  },
})
