# Skill: Autonomous Isolated DCA Grid Trader

## Description
A high-frequency accumulation and take-profit engine designed for the Base network. This skill allows an agent to execute independent DCA batches with granular profit tracking and capital protection.

## Capabilities
* **Isolated Batch Tracking:** Every purchase is tracked as a unique entry to maximize exit opportunities during volatility.
* **Local Oracle Routing:** Bypasses external API dependency by using native CoW Protocol routing for real-time price discovery.
* **Fault-Tolerant Execution:** Specifically engineered to handle Windows-based Node.js C++ threading errors without losing state.
* **Dynamic Risk Management:** Hard-capped 5 USDC budget with an automated pause (Circuit Breaker) when the grid is full.

## Configuration Parameters
- `checkInterval`: 3600000ms (Hourly)
- `buyAmount`: 0.2 USDC
- `profitTarget`: 1.10 (10% per batch)
- `maxActiveBatches`: 25
