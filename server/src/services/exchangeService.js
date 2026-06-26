const crypto = require('crypto');
const axios = require('axios');
const ApiKey = require('../models/ApiKey');
const { decryptData } = require('../utils/encryption');
const config = require('../config/env');

class ExchangeService {
    constructor(userId) {
        this.userId = userId;
        this.apiKey = null;
        this.apiSecret = null;
    }

    async init() {
        const keyRecord = await ApiKey.findOne({
            userId: this.userId,
            exchange: 'delta',
            isActive: true
        });

        if (!keyRecord) {
            throw new Error('No active Delta API key found. Add one in Settings → API Keys.');
        }

        this.apiKey = decryptData(keyRecord.apiKeyEncrypted);
        this.apiSecret = decryptData(keyRecord.apiSecretEncrypted);
    }

    _generateSignature(method, timestamp, path, payload = '') {
        const signatureData = method + timestamp + path + payload;
        return crypto.createHmac('sha256', this.apiSecret).update(signatureData).digest('hex');
    }

    async _request(method, path, data = null) {
        if (!this.apiKey || !this.apiSecret) {
            await this.init();
        }

        const timestamp = Math.floor(Date.now() / 1000).toString();
        const payloadStr = data && Object.keys(data).length > 0 ? JSON.stringify(data) : '';
        const signature = this._generateSignature(method, timestamp, path, payloadStr);

        const headers = {
            'api-key': this.apiKey,
            'timestamp': timestamp,
            'signature': signature,
            'User-Agent': 'CryptoX/1.0'
        };
        if (payloadStr) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const url = `${config.deltaBaseUrl}${path}`;
            const response = await axios({
                method,
                url,
                headers,
                data: payloadStr ? data : undefined,
                timeout: 15000
            });
            return response.data;
        } catch (error) {
            const status = error.response?.status;
            const msg = error.response?.data?.error?.message || error.message;
            console.error(`Delta API ${status || 'ERR'} ${method} ${path}: ${msg}`);
            throw new Error(msg || 'Exchange API request failed');
        }
    }

    /**
     * Validate API credentials against Delta Exchange
     */
    static async testCredentials(apiKey, apiSecret) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const path = '/v2/wallet/balances';
        const signatureData = 'GET' + timestamp + path;
        const signature = crypto.createHmac('sha256', apiSecret).update(signatureData).digest('hex');

        try {
            const response = await axios.get(`${config.deltaBaseUrl}${path}`, {
                headers: {
                    'api-key': apiKey,
                    'timestamp': timestamp,
                    'signature': signature,
                    'User-Agent': 'CryptoX/1.0'
                },
                timeout: 15000
            });
            return response.data.success;
        } catch (error) {
            throw new Error(error.response?.data?.error?.message || 'Invalid API credentials');
        }
    }

    /** Fetch wallet balances (all assets with any balance or fee credit) */
    async getBalances() {
        const data = await this._request('GET', '/v2/wallet/balances');
        if (!data.success) throw new Error('Failed to fetch balances');
        // Return all that have any positive balance OR fee credit
        return data.result.filter(b =>
            parseFloat(b.balance) > 0 ||
            parseFloat(b.available_balance) > 0 ||
            parseFloat(b.trading_fee_credit) > 0
        );
    }

    /** Fetch open margin positions */
    async getPositions() {
        const data = await this._request('GET', '/v2/positions/margined');
        if (!data.success) throw new Error('Failed to fetch positions');
        return data.result;
    }

    /**
     * Fetch historical OHLCV candles (public — no auth required)
     */
    static async fetchHistoricalCandles(symbol, resolution, start, end) {
        try {
            const response = await axios.get(`${config.deltaBaseUrl}/v2/history/candles`, {
                params: { symbol, resolution, start, end },
                timeout: 15000
            });
            if (!response.data.success) throw new Error('Delta returned unsuccessful response');
            return response.data.result;
        } catch (error) {
            const msg = error.response?.data?.error?.message || error.message;
            console.error(`Historical candles error [${symbol} ${resolution}]: ${msg}`);
            throw new Error(msg || 'Failed to fetch historical data');
        }
    }
}

module.exports = ExchangeService;
