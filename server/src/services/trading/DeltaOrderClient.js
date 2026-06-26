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
            if (method.toUpperCase() === 'GET' && params) {
                const qs = new URLSearchParams(params).toString();
                if (qs) {
                    signPath += '?' + qs;
                }
            }
            const { timestamp, signature } = this._sign(method, signPath, body || '');
            const headers = {
                'api-key':   this.apiKey,
                'timestamp': timestamp,
                'signature': signature,
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
                const errMsg = deltaError.message || deltaError.desc || JSON.stringify(deltaError);
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
        const { symbol, side, size, orderType, price, stopLoss, takeProfit, leverage, reduceOnly } = params;

        const body = {
            product_symbol: symbol,
            side,
            size,
            order_type: orderType,
        };

        if (reduceOnly) {
            body.reduce_only = true;
        }

        // Limit price
        if (orderType === 'limit_order' && price) {
            body.limit_price = price.toString();
        }

        // Bracket orders — stop loss
        if (stopLoss) {
            body.bracket_stop_loss_price  = stopLoss.toString();
            body.bracket_stop_loss_limit_price = stopLoss.toString();
        }

        // Bracket orders — take profit
        if (takeProfit) {
            body.bracket_take_profit_price       = takeProfit.toString();
            body.bracket_take_profit_limit_price = takeProfit.toString();
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
        return this._request('DELETE', '/v2/orders', null, {
            id: orderId.toString(),
            product_id: prod.id,
        });
    }

    /**
     * Cancel all orders for a symbol.
     */
    async cancelAllOrders(symbol) {
        return this._request('DELETE', '/v2/orders/all', null, { product_symbol: symbol });
    }

    /**
     * Close a position by placing a market order in the opposite direction.
     */
    async closePosition(symbol, size, side) {
        const closeSide = side === 'buy' ? 'sell' : 'buy';
        return this.placeOrder({
            symbol,
            side: closeSide,
            size,
            orderType: 'market_order',
        });
    }

    /**
     * Get fills (executed trades) with optional date filter.
     */
    async getFills(symbol, limit = 50) {
        const params = { page_size: limit };
        if (symbol) params.product_symbol = symbol;
        return this._request('GET', '/v2/fills', null, params);
    }
}

module.exports = DeltaOrderClient;
