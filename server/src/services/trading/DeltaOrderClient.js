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

// ─── Bracket order slippage buffer ─────────────────────────────────────────────
// When trigger price == limit price on a stop-limit bracket order, the limit order
// may not fill if the market moves quickly past the trigger before the order lands.
// Adding this small offset between trigger and limit guarantees the limit is always
// on the "fillable" side of the trigger price.
const BRACKET_SLIPPAGE_PCT = 0.0005; // 0.05% — small enough to be negligible, big enough to guarantee fill

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

        // Bracket orders — stop loss
        // bracket_stop_loss_price       = Trigger price (activates the bracket leg)
        // bracket_stop_loss_limit_price = Limit price (where the order rests in the book)
        //
        // We offset the limit slightly from the trigger so the market doesn't skip past
        // the limit before it fills:
        //   BUY entry (long)  → SL is a SELL → limit slightly BELOW trigger (1 - 0.05%)
        //   SELL entry (short) → SL is a BUY  → limit slightly ABOVE trigger (1 + 0.05%)
        if (stopLoss || stopLossTrigger) {
            const slTrigger   = parseFloat(stopLossTrigger || stopLoss);
            const slipFactor  = side === 'buy' ? (1 - BRACKET_SLIPPAGE_PCT) : (1 + BRACKET_SLIPPAGE_PCT);
            const slLimit     = parseFloat((slTrigger * slipFactor).toPrecision(8));
            body.bracket_stop_loss_price       = slTrigger.toString();
            body.bracket_stop_loss_limit_price = slLimit.toString();
        }

        // Bracket orders — take profit
        // Same offset logic as SL:
        //   BUY entry (long)  → TP is a SELL → limit slightly BELOW trigger (1 - 0.05%)
        //   SELL entry (short) → TP is a BUY  → limit slightly ABOVE trigger (1 + 0.05%)
        if (takeProfit || takeProfitTrigger) {
            const tpTrigger   = parseFloat(takeProfitTrigger || takeProfit);
            const slipFactor  = side === 'buy' ? (1 - BRACKET_SLIPPAGE_PCT) : (1 + BRACKET_SLIPPAGE_PCT);
            const tpLimit     = parseFloat((tpTrigger * slipFactor).toPrecision(8));
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
