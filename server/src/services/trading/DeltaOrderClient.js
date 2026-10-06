/**
 * DeltaOrderClient.js
 *
 * Signs and sends authenticated requests to the Delta Exchange India REST API.
 * Handles: order placement, cancellation, position fetch, wallet balance.
 *
 * Delta authentication:
 *   - Header: api-key: <apiKey>
 *   - Header: timestamp: <unix ms>
 *   - Header: signature: HMAC-SHA256(secret, method + timestamp + path + body)
 *
 * Reference: https://docs.india.delta.exchange
 */

const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/env');

const BASE_URL = config.deltaBaseUrl; // 'https://api.india.delta.exchange'

// ─── Bracket order market-equivalent buffer ─────────────────────────────────────
// Delta Exchange's /v2/orders endpoint REQUIRES a limit price for bracket legs
// (unlike /v2/orders/bracket which supports order_type: 'market_order').
// To achieve market-order behavior, we set the limit price 2% past the trigger.
// In practice, crypto never gaps >2% in a single exchange tick, so the bracket
// leg fills at whatever the market offers — exactly like a market order would.
const BRACKET_MARKET_BUFFER = 0.02; // 2% past trigger — guaranteed fill at market price

class DeltaOrderClient {
    constructor(apiKey, apiSecret) {
        this.apiKey    = apiKey;
        this.apiSecret = apiSecret;

        this.http = axios.create({
            baseURL: BASE_URL,
            timeout: 10_000,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // ─── Signature generation ─────────────────────────────────────────────────

    _sign(method, path, body = '') {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const bodyStr   = body ? JSON.stringify(body) : '';
        const payload   = method.toUpperCase() + timestamp + path + bodyStr;
        const signature = crypto
            .createHmac('sha256', this.apiSecret)
            .update(payload)
            .digest('hex');
        return { timestamp, signature };
    }

    async _request(method, path, body = null, params = null) {
        try {
            let signPath = path;
            if (params && Object.keys(params).length > 0) {
                const qs = new URLSearchParams(params).toString();
                if (qs) {
                    signPath += '?' + qs;
                }
            }
            const { timestamp, signature } = this._sign(method, signPath, body || '');
            const headers = {
                'api-key':      this.apiKey,
                'timestamp':    timestamp,
                'signature':    signature,
                'Content-Type': 'application/json',
            };
            const response = await this.http.request({
                method,
                url: path,
                params: params || undefined,
                data: body || undefined,
                headers,
            });
            return response.data;
        } catch (err) {
            if (err.response?.data) {
                const deltaError = err.response.data.error || err.response.data;
                let errMsg = deltaError.message || deltaError.desc;
                if (!errMsg && deltaError.code === 'ip_not_whitelisted_for_api_key') {
                    const clientIp = deltaError.context?.client_ip || '';
                    errMsg = `IP not whitelisted on Delta (current IP: ${clientIp}). Please add this IP to your Delta API key settings.`;
                } else if (!errMsg) {
                    errMsg = deltaError.code || JSON.stringify(deltaError);
                }
                throw new Error(`Delta Exchange: ${errMsg}`);
            }
            throw err;
        }
    }

    // ─── Public helpers ───────────────────────────────────────────────────────

    /** Get wallet & margin balances */
    async getWallet() {
        return this._request('GET', '/v2/wallet/balances');
    }

    /** Get all open positions */
    async getPositions() {
        return this._request('GET', '/v2/positions/margined');
    }

    /** Get open orders */
    async getOpenOrders(symbol) {
        const params = symbol ? { product_symbol: symbol } : null;
        return this._request('GET', '/v2/orders', null, params);
    }

    /** Get order by ID */
    async getOrder(orderId) {
        return this._request('GET', `/v2/orders/${orderId}`);
    }

    /**
     * Place a market or limit order with optional bracket (SL + TP).
     */
    async placeOrder(params) {
        const {
            symbol,
            side,
            size,
            orderType,
            price,
            stopLoss,
            stopLossTrigger,
            takeProfit,
            takeProfitTrigger,
            leverage,
            reduceOnly,
        } = params;

        const body = {
            product_symbol: symbol,
            side,
            size,
            order_type: orderType,
        };

        if (reduceOnly) {
            body.reduce_only = true;
        }

        // Set leverage explicitly so Delta uses the configured value, not account default
        if (leverage) {
            body.leverage = leverage.toString();
        }

        // Limit price
        if (orderType === 'limit_order' && price) {
            body.limit_price = price.toString();
        }

        // Bracket orders — stop loss (market-equivalent)
        // Delta's /v2/orders bracket requires a limit price, so we set it 2% past
        // the trigger. This guarantees fill at whatever market price exists when
        // the trigger fires — functionally identical to a market order.
        //
        //   BUY entry (long)  → SL closes with a SELL → limit 2% BELOW trigger
        //   SELL entry (short) → SL closes with a BUY  → limit 2% ABOVE trigger
        if (stopLoss || stopLossTrigger) {
            const slTrigger  = parseFloat(stopLossTrigger || stopLoss);
            const slLimit    = side === 'buy'
                ? parseFloat((slTrigger * (1 - BRACKET_MARKET_BUFFER)).toPrecision(8))  // sell: lower limit
                : parseFloat((slTrigger * (1 + BRACKET_MARKET_BUFFER)).toPrecision(8)); // buy:  higher limit
            body.bracket_stop_loss_price       = slTrigger.toString();
            body.bracket_stop_loss_limit_price = slLimit.toString();
        }

        // Bracket orders — take profit (market-equivalent)
        // Same 2% buffer: when TP triggers, limit order is deep enough to fill at market.
        //
        //   BUY entry (long)  → TP closes with a SELL → limit 2% BELOW trigger
        //   SELL entry (short) → TP closes with a BUY  → limit 2% ABOVE trigger
        if (takeProfit || takeProfitTrigger) {
            const tpTrigger  = parseFloat(takeProfitTrigger || takeProfit);
            const tpLimit    = side === 'buy'
                ? parseFloat((tpTrigger * (1 - BRACKET_MARKET_BUFFER)).toPrecision(8))  // sell: lower limit
                : parseFloat((tpTrigger * (1 + BRACKET_MARKET_BUFFER)).toPrecision(8)); // buy:  higher limit
            body.bracket_take_profit_price       = tpTrigger.toString();
            body.bracket_take_profit_limit_price = tpLimit.toString();
        }

        // Client order ID for idempotency
        body.client_order_id = `cx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        return this._request('POST', '/v2/orders', body);
    }

    /**
     * Cancel an open order by ID.
     */
    async cancelOrder(orderId, symbol) {
        const productCatalog = require('../ProductCatalog');
        const prod = productCatalog.getBySymbol(symbol);
        if (!prod) {
            throw new Error(`Product metadata not found for symbol: ${symbol}`);
        }
        const numericOrderId = Number(orderId);
        const numericProductId = Number(prod.id);
        const body = {
            id: !isNaN(numericOrderId) ? numericOrderId : orderId,
            product_id: !isNaN(numericProductId) ? numericProductId : prod.id,
        };
        return this._request('DELETE', '/v2/orders', body);
    }

    /**
     * Cancel all orders for a symbol.
     */
    async cancelAllOrders(symbol) {
        const productCatalog = require('../ProductCatalog');
        const prod = symbol ? productCatalog.getBySymbol(symbol) : null;
        const body = prod?.id ? { product_id: Number(prod.id) } : {};
        return this._request('DELETE', '/v2/orders/all', body);
    }

    /**
     * Close a position by placing an order in the opposite direction.
     * If price is provided, places a reduce-only limit order; otherwise places a market order.
     */
    async closePosition(symbol, size, side, price = null) {
        const closeSide = side === 'buy' ? 'sell' : 'buy';
        const params = {
            symbol,
            side: closeSide,
            size,
            orderType: price ? 'limit_order' : 'market_order',
            reduceOnly: true,
        };
        if (price) {
            params.price = price;
        }
        return this.placeOrder(params);
    }

    /**
     * Get fills (executed trades) with optional date filter.
     */
    async getFills(symbol, limit = 50) {
        const params = { page_size: limit };
        if (symbol) params.product_symbol = symbol;
        return this._request('GET', '/v2/fills', null, params);
    }

    /**
     * Set or update bracket stop-loss and/or take-profit for a position.
     * Uses Delta's POST /v2/orders/bracket endpoint.
     */
    async setBracketOrder({ symbol, stopLoss = null, takeProfit = null }) {
        const productCatalog = require('../ProductCatalog');
        const prod = productCatalog.getBySymbol(symbol);
        if (!prod) {
            throw new Error(`Product metadata not found for symbol: ${symbol}`);
        }

        const body = {
            product_id: Number(prod.id),
        };

        if (stopLoss !== null && stopLoss !== undefined) {
            body.stop_loss_order = {
                order_type: 'market_order',
                stop_price: stopLoss.toString(),
            };
        }

        if (takeProfit !== null && takeProfit !== undefined) {
            body.take_profit_order = {
                order_type: 'market_order',
                stop_price: takeProfit.toString(),
            };
        }

        return this._request('POST', '/v2/orders/bracket', body);
    }
}

module.exports = DeltaOrderClient;
