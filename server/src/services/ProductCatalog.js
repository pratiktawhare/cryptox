/**
 * ProductCatalog.js
 *
 * Fetches ALL tradable perpetual futures from Delta Exchange India on boot,
 * caches them in memory, and auto-refreshes every 6 hours.
 *
 * Provides:
 *   - Full product list (Map by symbol)
 *   - Quick lookup by symbol or product_id
 *   - Exposes via REST: GET /api/market/products
 *   - Broadcasts catalog to new Socket.IO clients
 */

const axios = require('axios');
const config = require('../config/env');

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 15_000;

class ProductCatalog {
    constructor() {
        /** @type {Map<string, object>} symbol → product */
        this.bySymbol = new Map();

        /** @type {Map<number, object>} product_id → product */
        this.byId = new Map();

        /** @type {object[]} flat sorted array for REST responses */
        this.list = [];

        this._refreshTimer = null;
        this._ready = false;
    }

    // ─── Public API ────────────────────────────────────────────

    /** Returns true once the first fetch has completed */
    get isReady() { return this._ready; }

    /** Returns the full product list array */
    getAll() { return this.list; }

    /** Look up a product by symbol (e.g. 'BTCUSD') */
    getBySymbol(symbol) { return this.bySymbol.get(symbol?.toUpperCase()); }

    /** Look up a product by its numeric Delta product_id */
    getById(id) { return this.byId.get(id); }

    /** Returns all symbols in the catalog */
    getSymbols() { return Array.from(this.bySymbol.keys()); }

    // ─── Lifecycle ─────────────────────────────────────────────

    /**
     * Fetch the catalog from Delta, parse, and cache.
     * Called once on server boot, then on a timer.
     */
    async init() {
        await this._fetch();
        this._scheduleRefresh();
    }

    destroy() {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
    }

    // ─── Internal ──────────────────────────────────────────────

    _scheduleRefresh() {
        this._refreshTimer = setInterval(async () => {
            try {
                await this._fetch();
            } catch (err) {
                console.error('[ProductCatalog] Refresh failed:', err.message);
            }
        }, REFRESH_INTERVAL_MS);
    }

    async _fetch() {
        console.log('[ProductCatalog] Fetching products from Delta Exchange…');
        try {
            // Use server-side filter — Delta India supports contract_types param
            const resp = await axios.get(`${config.deltaBaseUrl}/v2/products`, {
                timeout: FETCH_TIMEOUT_MS,
                params: {
                    contract_types: 'perpetual_futures',
                    page_size: 500,         // fetch all in one shot
                },
            });

            const raw = resp.data?.result ?? [];

            // Additional client-side guard for state
            const perpetuals = raw.filter((p) => p.state === 'live' || !p.state);

            const bySymbol = new Map();
            const byId = new Map();

            for (const p of perpetuals) {
                const product = {
                    id: p.id,
                    symbol: p.symbol,
                    description: p.description || p.symbol,
                    underlying_asset: p.underlying_asset?.symbol || '',
                    quoting_asset: p.quoting_asset?.symbol || 'USD',
                    tick_size: parseFloat(p.tick_size) || 0.5,
                    contract_value: parseFloat(p.contract_value) || 1,
                    maker_commission_rate: parseFloat(p.maker_commission_rate) || 0,
                    taker_commission_rate: parseFloat(p.taker_commission_rate) || 0.0005,
                    initial_margin: parseFloat(p.initial_margin_scaling_factor) || 0.1,
                    maintenance_margin: parseFloat(p.maintenance_margin_scaling_factor) || 0.05,
                    max_leverage: parseFloat(p.max_leverage) || 10,
                    // Derived nice name: "BTC/USD Perpetual"
                    displayName: `${p.underlying_asset?.symbol || p.symbol.replace('USD', '')}/${p.quoting_asset?.symbol || 'USD'}`,
                };
                bySymbol.set(product.symbol, product);
                byId.set(product.id, product);
            }

            // Sort: BTC, ETH first, then alphabetically
            const priority = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD'];
            const sorted = [...bySymbol.values()].sort((a, b) => {
                const ai = priority.indexOf(a.symbol);
                const bi = priority.indexOf(b.symbol);
                if (ai !== -1 && bi !== -1) return ai - bi;
                if (ai !== -1) return -1;
                if (bi !== -1) return 1;
                return a.symbol.localeCompare(b.symbol);
            });

            this.bySymbol = bySymbol;
            this.byId = byId;
            this.list = sorted;
            this._ready = true;

            console.log(`[ProductCatalog] ✅ Loaded ${sorted.length} perpetual futures`);
        } catch (err) {
            console.error('[ProductCatalog] ❌ Fetch error:', err.message);
            // Don't crash — keep the old catalog if we had one
            if (!this._ready) throw err; // Fatal on first boot
        }
    }
}

// Singleton
module.exports = new ProductCatalog();
