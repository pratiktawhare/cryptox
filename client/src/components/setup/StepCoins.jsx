import React from 'react';
import Button from '../common/Button';

const availableCoins = [
    { symbol: 'BTCUSD', name: 'Bitcoin', color: '#f7931a' },
    { symbol: 'ETHUSD', name: 'Ethereum', color: '#627eea' },
    { symbol: 'SOLUSD', name: 'Solana', color: '#00ffa3' },
    { symbol: 'BNBUSD', name: 'BNB', color: '#f3ba2f' },
    { symbol: 'XRPUSD', name: 'Ripple', color: '#0085c0' },
    { symbol: 'ADAUSD', name: 'Cardano', color: '#0033ad' },
    { symbol: 'AVAXUSD', name: 'Avalanche', color: '#e84142' },
    { symbol: 'DOTUSD', name: 'Polkadot', color: '#e6007a' },
    { symbol: 'LINKUSD', name: 'Chainlink', color: '#2a5ada' },
    { symbol: 'MATICUSD', name: 'Polygon', color: '#8247e5' },
];

const StepCoins = ({ formData, updateData, prevStep, submitSetup, loading, error }) => {
    const toggleCoin = (symbol) => {
        const current = formData.trackedCoins;
        const next = current.includes(symbol)
            ? current.filter((c) => c !== symbol)
            : [...current, symbol];
        updateData({ trackedCoins: next });
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-crypto-heading">Select coins to track</h2>
                <p className="text-sm text-crypto-muted mt-1">
                    Choose which markets to monitor. You can change this later.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {availableCoins.map((coin) => {
                    const selected = formData.trackedCoins.includes(coin.symbol);
                    return (
                        <button
                            key={coin.symbol}
                            type="button"
                            onClick={() => toggleCoin(coin.symbol)}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                                selected
                                    ? 'border-crypto-primary bg-crypto-primary/10 ring-1 ring-crypto-primary/30'
                                    : 'border-crypto-border bg-crypto-input hover:border-crypto-muted'
                            }`}
                        >
                            <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{ backgroundColor: coin.color }}
                            >
                                {coin.symbol.slice(0, 1)}
                            </div>
                            <div className="text-left">
                                <div className={`text-sm font-semibold ${selected ? 'text-crypto-primary' : 'text-crypto-heading'}`}>
                                    {coin.symbol.replace('USD', '')}
                                </div>
                                <div className="text-[10px] text-crypto-muted">{coin.name}</div>
                            </div>
                            {selected && (
                                <svg className="w-4 h-4 text-crypto-primary ml-auto shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                            )}
                        </button>
                    );
                })}
            </div>

            <p className="text-xs text-crypto-muted mt-3">
                {formData.trackedCoins.length} coin{formData.trackedCoins.length !== 1 ? 's' : ''} selected
            </p>

            {error && (
                <div className="mt-4 text-sm text-crypto-danger bg-crypto-danger/10 border border-crypto-danger/20 px-4 py-3 rounded-lg animate-fade-in">
                    {error}
                </div>
            )}

            <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={prevStep} className="flex-1">
                    Back
                </Button>
                <Button
                    onClick={submitSetup}
                    loading={loading}
                    disabled={formData.trackedCoins.length === 0}
                    className="flex-1"
                >
                    Launch CryptoX
                </Button>
            </div>
        </div>
    );
};

export default StepCoins;
