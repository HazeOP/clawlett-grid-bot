# 🦞 Clawlett Autonomous DCA Grid Engine

**A fault-tolerant, fully autonomous algorithmic trading agent built for the Clawlett & OpenClaw 5,000 USDC Trading Challenge.**

This project implements an **Isolated DCA (Dollar Cost Averaging) Grid Strategy** on the Base network using the Clawlett non-ruggable Safe architecture and CoW Protocol for MEV-protected swaps.

## 🧠 The Strategy: Isolated Take-Profit
Unlike standard DCA bots that average down a single massive bag, this engine treats every hourly purchase as an independent, isolated batch.
* **Accumulation:** Buys exactly 0.2 USDC of the target token (e.g., $BID) every hour.
* **Isolated Profit Taking:** Monitors the precise entry price of *each specific batch*. When an individual batch hits strictly +10% profit, it is sold to free up capital. Downside batches are held patiently until they recover.
* **Capital Protection (Circuit Breaker):** Enforces a strict 5 USDC maximum budget (25 concurrent batches). If the market dumps and 25 batches remain unsold, the bot automatically pauses buying to protect capital and waits for a profitable exit.

## 🛠️ Technical Innovations & Bypass Engineering

Building a stable bot on Windows using standard RPCs often leads to rate limits and core Node.js crashes. This engine implements several custom engineering solutions:

### 1. The Fault-Tolerant "Local Oracle"
Instead of relying on fragile, rate-limited external web APIs to check prices, this bot uses Clawlett's native `swap.js` routing engine as a local price oracle. It spawns asynchronous background processes to dry-run CoW Protocol swaps, extracting the exact MEV-protected routing quotes directly from the CLI output.

### 2. Windows C++ Exit Crash Bypass
In Node v22/v24 on Windows, asynchronous network threads closing out during a synchronous script exit often trigger a fatal C++ panic (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`). 
To bypass this, the engine uses a custom `execAsync` wrapper that catches the fatal exit code, parses the wreckage of the `stdout` buffer, and successfully extracts the quote or execution confirmation even if the child process dies.

### 3. Persistent State Memory
The bot maintains a `strategy_state.json` ledger. Every execution, quote, and target is instantly logged to the hard drive. If the machine restarts or the process is killed, the bot wakes up, reads the ledger, and seamlessly resumes tracking its active grid without losing a single cent of context.

### 4. High-Capacity RPC Routing
To prevent default-node rate limiting (which results in silent `CALL_EXCEPTION` failures) while avoiding out-of-sync free nodes, the engine automatically routes all background oracle requests through Enterprise-grade `publicnode` infrastructure.

## 🚀 How to Run

1. Clone the repository and configure your Clawlett `wallet.json`.
2. Ensure you have USDC in your Safe.
3. Run the engine:
```bash
node strategy_dca.js
