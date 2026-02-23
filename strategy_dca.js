import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- Configuration ---
const CONFIG = {
    buyAmount: 0.2,          // USDC per buy
    targetProfit: 0.10,      // 10% profit
    budget: 5.0,             // Total max investment
    checkInterval: 5 * 60 * 1000, // 5 minutes
    buyInterval: 60 * 60 * 1000, // 1 hour
    token: 'BID',
    stable: 'USDC',
    stateFile: 'strategy_state.json'
};

// --- State Management ---
function loadState() {
    if (fs.existsSync(CONFIG.stateFile)) {
        return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
    }
    return {
        buys: [],           // Array of { time, amountToken, costUsdc, sold: false }
        totalInvested: 0,   // Net invested (buys - sells)
        lastBuyTime: 0
    };
}

function saveState(state) {
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

import { execSync } from 'child_process';

// --- Helper: Execute Shell Command (Async) ---
// Uses execAsync to prevent the Node.js Windows assertion bug (async.c)
async function runCommand(command) {
    try {
        console.log(`[EXEC] Running: ${command}`);
        // Await the asynchronous execution instead of using the blocking execSync
        const { stdout, stderr } = await execAsync(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return stdout.trim();
    } catch (error) {
        const stdout = error.stdout ? error.stdout.toString().trim() : '';
        const stderr = error.stderr ? error.stderr.toString().trim() : '';
        
        console.error(`[EXEC] Command failed with code ${error.code || error.status}`);
        if (stderr) console.error(`[EXEC] Stderr: ${stderr}`);
        
        // Check if it was actually a success (e.g. Node assertion error on exit but task done)
        if (stdout.includes('SWAP COMPLETE') || stdout.includes('Transaction:') || stdout.includes('QUOTE ONLY') || stdout.includes('You receive:')) {
            console.log(`[EXEC] ...Windows crashed on exit, but the data was successfully captured.`);
            return stdout;
        }
        
        return null;
    }
}

// --- Helper: Get Token Quote ---
// Uses the existing swap.js tool to get estimated output amount
async function getQuote(fromToken, toToken, amount) {
    // Run swap.js in dry-run mode (no --execute)
    const cmd = `node swap.js --from ${fromToken} --to ${toToken} --amount ${amount} --rpc https://base.publicnode.com`;
    const output = await runCommand(cmd);
    
    if (!output) return 0;

    // Parse output for "You receive: ~123.45" or similar lines from swap.js
    // Expected output format from previous logs:
    // "You receive:  ~4.480414 USDC"
    // "Min receive:  4.449229 USDC"
    
    const match = output.match(/You receive:\s+~?([0-9.]+)/);
    if (match && match[1]) {
        return parseFloat(match[1]);
    }
    return 0;
}

// --- Core Logic ---
async function tick() {
    console.log(`\n--- Tick: ${new Date().toISOString()} ---`);
    let state = loadState();

    // 1. Check for Sells (Profit Taking)
    // We check each unsold position to see if it's up 10%
    
    let activeBuys = state.buys.filter(b => !b.sold);
    console.log(`Tracking ${activeBuys.length} active positions. Total Invested: ${state.totalInvested.toFixed(2)} USDC`);

    // Iterate through active buys
    for (let i = 0; i < state.buys.length; i++) {
        let buy = state.buys[i];
        if (buy.sold) continue;

        // Check current value of this specific bag
        // Simulate selling 'buy.amountToken' of BID to USDC
        const currentVal = await getQuote(CONFIG.token, CONFIG.stable, buy.amountToken);
        const targetVal = buy.costUsdc * (1 + CONFIG.targetProfit);

        console.log(`Pos #${i + 1}: ${buy.amountToken.toFixed(2)} ${CONFIG.token} | Cost: ${buy.costUsdc} | Value: ${currentVal.toFixed(4)} | Target: ${targetVal.toFixed(4)}`);

        if (currentVal >= targetVal) {
            console.log(`>>> TARGET HIT! Selling position #${i + 1}...`);
            const sellCmd = `node swap.js --from ${CONFIG.token} --to ${CONFIG.stable} --amount ${buy.amountToken} --execute --rpc https://base.publicnode.com`;
            console.log(`Executing sell: ${sellCmd}`);
            
            const result = await runCommand(sellCmd);
            
            if (result && result.includes('SWAP COMPLETE')) {
                buy.sold = true;
                buy.sellTime = Date.now();
                buy.sellValue = currentVal;
                
                // Reduce total invested by the original cost
                state.totalInvested = Math.max(0, state.totalInvested - buy.costUsdc);
                
                console.log(`>>> Sold! Recycled ${buy.costUsdc} USDC to budget.`);
                saveState(state);
            } else {
                console.error("Sell failed or timed out. Will retry next tick.");
            }
        }
    }

    // 2. Check for Buys
    const now = Date.now();
    const timeSinceLastBuy = now - state.lastBuyTime;
    
    // Check if it's time to buy AND we have budget
    if (timeSinceLastBuy >= CONFIG.buyInterval) {
        if (state.totalInvested + CONFIG.buyAmount <= CONFIG.budget) {
            console.log(`>>> Time to buy! Budget available (${state.totalInvested.toFixed(2)}/${CONFIG.budget}).`);
            
            // First, get a quote to see how many tokens we get
            const expectedTokens = await getQuote(CONFIG.stable, CONFIG.token, CONFIG.buyAmount);
            
            if (expectedTokens > 0) {
                const buyCmd = `node swap.js --from ${CONFIG.stable} --to ${CONFIG.token} --amount ${CONFIG.buyAmount} --execute --rpc https://base.publicnode.com`;
                
                const result = await runCommand(buyCmd);

                if (result && result.includes('SWAP COMPLETE')) {
                    // Record successful buy
                    state.buys.push({
                        time: now,
                        costUsdc: CONFIG.buyAmount,
                        amountToken: expectedTokens, // Use expected value or parse from result if possible
                        sold: false
                    });
                    state.lastBuyTime = now;
                    state.totalInvested += CONFIG.buyAmount;
                    saveState(state);
                    console.log(`>>> Buy complete. Added to tracker.`);
                } else {
                     console.error("Buy failed or timed out. Will retry next tick.");
                }
            } else {
                console.log("Error getting quote (zero tokens returned), skipping buy.");
            }
        } else {
            console.log(`>>> Buy skipped: Budget cap reached (${state.totalInvested.toFixed(2)}/${CONFIG.budget} USDC). Waiting for sales.`);
        }
    } else {
        const minutesUntilBuy = ((CONFIG.buyInterval - timeSinceLastBuy) / 60000).toFixed(1);
        console.log(`Next buy allowed in ${minutesUntilBuy} minutes.`);
    }
}

// --- Runner ---
console.log("Starting Grid/DCA Bot (ESM)...");
console.log(`Config: Buy ${CONFIG.buyAmount} ${CONFIG.stable} of ${CONFIG.token} every 1h.`);
console.log(`Sell: When value +${(CONFIG.targetProfit * 100).toFixed(0)}%.`);
console.log(`Budget: ${CONFIG.budget} ${CONFIG.stable}.`);

// Initial Run immediately
await tick();

// Loop
setInterval(tick, CONFIG.checkInterval);
