# Load environment variables
-include .env

RPC_URL_SEPOLIA := $(RPC_URL_SEPOLIA)
RPC_URL_LOCAL := http://127.0.0.1:8545
ACCOUNT := acc3
ETHERSCAN_API_KEY := $(ETHERSCAN_API_KEY)

CONTRACT := $(CONTRACT_ADDRESS)
USER := $(USER_ADDRESS)

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
	forge script script/DeployWatcher.sol \
	--rpc-url $(RPC_URL_SEPOLIA) \
	--account $(ACCOUNT) \
	-vvv

deploy-sepolia:
	forge script script/DeployWatcher.sol \
	--rpc-url $(RPC_URL_SEPOLIA) \
	--account acc3 \
	--sender 0x0944f6502a7e99f073750000c4f7889611a706c6 \
	--broadcast \
	--verify \
	--etherscan-api-key $(ETHERSCAN_API_KEY) \
	-vvv

deploy-local:
	forge script script/DeployWatcher.sol \
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
# CONTRACT INTERACTIONS
# ================================

deposit:
	cast send $(CONTRACT) \
	"deposit()" \
	--value 1ether \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

withdraw:
	cast send $(CONTRACT) \
	"withdraw(uint256)" \
	100000000000000000 \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

withdraw-amount:
	cast send $(CONTRACT) \
	"withdraw(uint256)" \
	$(AMOUNT) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

execute:
	cast send $(CONTRACT) \
	"executeWithdraw(bytes)" \
	0x \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

cancel:
	cast send $(CONTRACT) \
	"cancelWithdraw()" \
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
	"setSafeAddress(address)" \
	$(SAFE) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

withdraw-to-safe:
	cast send $(CONTRACT) \
	"withdrawToSafe(uint256)" \
	$(AMOUNT) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

register-ledger:
	cast send $(CONTRACT) \
	"registerLedgerSigner(address)" \
	$(LEDGER_ADDR) \
	--account $(ACCOUNT) \
	--rpc-url $(RPC_URL_SEPOLIA)

# ================================
# VIEW FUNCTIONS
# ================================

balance:
	cast call $(CONTRACT) \
	"getUserVaultBalance(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

pending:
	cast call $(CONTRACT) \
	"hasPendingWithdraw(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

limit:
	cast call $(CONTRACT) \
	"getInstantWithdrawLimit(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

pending-data:
	cast call $(CONTRACT) \
	"getPendingWithdraw(address)" \
	$(USER) \
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
	"getRemainingPendingTime(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

user-state:
	cast call $(CONTRACT) \
	"getUserState(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)

vault-balance:
	cast call $(CONTRACT) \
	"totalBalance()" \
	--rpc-url $(RPC_URL_SEPOLIA)

ledger-state:
	cast call $(CONTRACT) \
	"getLedgerSignerState(address)" \
	$(USER) \
	--rpc-url $(RPC_URL_SEPOLIA)