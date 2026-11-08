# Load environment variables
-include .env

RPC_URL_SEPOLIA := $(RPC_URL_SEPOLIA)
RPC_URL_LOCAL := http://127.0.0.1:8545
ACCOUNT := acc3
SENDER := 0x0944f6502a7e99f073750000c4f7889611a706c6
ETHERSCAN_API_KEY := $(ETHERSCAN_API_KEY)

CONTRACT := $(CONTRACT_ADDRESS)
USER := $(USER_ADDRESS)
TOKEN := $(TOKEN_ADDRESS)
AMOUNT := $(AMOUNT)

# ================================
# BUILD
# ================================

build:
	forge build

clean:
	forge clean

rebuild:
	forge clean && forge build

format:
	forge fmt

# ================================
# TESTING
# ================================

test:
	forge test -vv

test-verbose:
	forge test -vvvv

gas:
	forge test --gas-report

trace:
	forge test --debug

coverage:
	forge coverage

# ================================
# DEPLOYMENT
# ================================

simulate:
	forge script script/DeployWatcher.s.sol \
	--rpc-url $(RPC_URL_SEPOLIA) \
	--account $(ACCOUNT) \
	-vvv

deploy-sepolia:
	forge script script/DeployWatcher.s.sol \
	--rpc-url $(RPC_URL_SEPOLIA) \
	--account $(ACCOUNT) \
	--sender $(SENDER) \
	--broadcast \
	--verify \
	--etherscan-api-key $(ETHERSCAN_API_KEY) \
	-vvv

deploy-local:
	forge script script/DeployWatcher.s.sol \
	--rpc-url $(RPC_URL_LOCAL) \
	--account $(ACCOUNT) \
	--broadcast \
	-vvv

# ================================
# FORKING
# ================================

fork-anvil:
	anvil --fork-url $(RPC_URL_SEPOLIA)

# ================================
# TOKEN SETUP (run once per token per user)
# approve Watcher to spend your tokens before depositing
# make approve TOKEN=0x... AMOUNT=1000000000000000000
# ================================

approve:
	cast send $(TOKEN) \
	"approve(address,uint256)" \
	$(CONTRACT) $(AMOUNT) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

# ================================
# CONTRACT INTERACTIONS
# usage: make deposit TOKEN=0x... AMOUNT=1000000000000000000
# ================================

deposit:
	cast send $(CONTRACT) \
	"deposit(address,uint256)" \
	$(TOKEN) $(AMOUNT) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

withdraw:
	cast send $(CONTRACT) \
	"withdraw(address,uint256)" \
	$(TOKEN) $(AMOUNT) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

execute:
	cast send $(CONTRACT) \
	"executeWithdraw(address)" \
	$(TOKEN) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

cancel:
	cast send $(CONTRACT) \
	"cancelWithdraw(address)" \
	$(TOKEN) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

lock:
	cast send $(CONTRACT) \
	"emergencyLock(uint256)" \
	3600 \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

safe-set:
	cast send $(CONTRACT) \
	"setSafeAddress(uint8,address)" \
	0 $(SAFE) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

withdraw-to-safe:
	cast send $(CONTRACT) \
	"withdrawToSafe(address,uint256)" \
	$(TOKEN) $(AMOUNT) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

# ================================
# VIEW FUNCTIONS
# usage: make balance TOKEN=0x...
# ================================

balance:
	cast call $(CONTRACT) \
	"getBalance(address,address)" \
	$(USER) $(TOKEN) \
	--rpc-url $(RPC_URL_SEPOLIA)

pending:
	cast call $(CONTRACT) \
	"hasPendingWithdraw(address,address)" \
	$(USER) $(TOKEN) \
	--rpc-url $(RPC_URL_SEPOLIA)

pending-data:
	cast call $(CONTRACT) \
	"getPendingWithdraw(address,address)" \
	$(USER) $(TOKEN) \
	--rpc-url $(RPC_URL_SEPOLIA)

locked:
	cast call $(CONTRACT) \
	"isVaultLocked(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

lock-time:
	cast call $(CONTRACT) \
	"getRemainingLockTime(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

pending-time:
	cast call $(CONTRACT) \
	"getRemainingPendingTime(address,address)" \
	$(USER) $(TOKEN) \
	--rpc-url $(RPC_URL_SEPOLIA)

user-token-state:
	cast call $(CONTRACT) \
	"getUserTokenState(address,address)" \
	$(USER) $(TOKEN) \
	--rpc-url $(RPC_URL_SEPOLIA)

allowed-token:
	cast call $(CONTRACT) \
	"allowedTokens(address)" \
	$(TOKEN) \
	--rpc-url $(RPC_URL_SEPOLIA)