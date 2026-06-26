import React from 'react';
import Input from '../common/Input';
import Button from '../common/Button';

const riskOptions = [
    { value: 'low', label: 'Conservative', desc: 'Max 1% risk per trade, lower leverage' },
    { value: 'medium', label: 'Moderate', desc: 'Max 2% risk per trade, balanced approach' },
    { value: 'high', label: 'Aggressive', desc: 'Max 5% risk per trade, higher leverage' },
];

const StepBudget = ({ formData, updateData, nextStep, prevStep, isFinalStep, submitSetup, loading, error }) => {
    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-crypto-heading">Budget & Risk</h2>
                <p className="text-sm text-crypto-muted mt-1">
                    Configure your trading budget and risk tolerance.
                </p>
            </div>

            <div className="space-y-5">
                {/* Budget */}
                <div className="flex gap-3">
                    <div className="flex-1">
                        <Input
                            label="Total Budget"
                            type="number"
                            min="0"
                            step="100"
                            value={formData.totalBudget}
                            onChange={(e) => updateData({ totalBudget: e.target.value })}
                            placeholder="10000"
                        />
                    </div>
                    <div className="w-24">
                        <label className="block text-sm font-medium text-crypto-heading mb-1.5">Currency</label>
                        <select
                            className="w-full rounded-lg bg-crypto-input text-crypto-heading border border-crypto-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-crypto-primary/20 focus:border-crypto-primary transition-all"
                            value={formData.budgetCurrency}
                            onChange={(e) => updateData({ budgetCurrency: e.target.value })}
                        >
                            <option value="INR">INR</option>
                            <option value="USD">USD</option>
                        </select>
                    </div>
                </div>

                {/* Max leverage */}
                <div>
                    <label className="block text-sm font-medium text-crypto-heading mb-1.5">
                        Max Leverage: <span className="text-crypto-primary font-bold">{formData.maxLeverage}×</span>
                    </label>
                    <input
                        type="range"
                        min="1"
                        max="20"
                        value={formData.maxLeverage}
                        onChange={(e) => updateData({ maxLeverage: parseInt(e.target.value) })}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer accent-crypto-primary bg-crypto-border"
                    />
                    <div className="flex justify-between text-xs text-crypto-muted mt-1">
                        <span>1×</span>
                        <span>10×</span>
                        <span>20×</span>
                    </div>
                </div>

                {/* Risk tolerance */}
                <div>
                    <label className="block text-sm font-medium text-crypto-heading mb-2">Risk Tolerance</label>
                    <div className="grid grid-cols-3 gap-2">
                        {riskOptions.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => updateData({ riskTolerance: opt.value })}
                                className={`p-3 rounded-lg border text-left transition-all duration-200 cursor-pointer ${
                                    formData.riskTolerance === opt.value
                                        ? 'border-crypto-primary bg-crypto-primary/10 ring-1 ring-crypto-primary/30'
                                        : 'border-crypto-border bg-crypto-input hover:border-crypto-muted'
                                }`}
                            >
                                <div className={`text-sm font-semibold ${
                                    formData.riskTolerance === opt.value ? 'text-crypto-primary' : 'text-crypto-heading'
                                }`}>
                                    {opt.label}
                                </div>
                                <div className="text-[10px] text-crypto-muted mt-0.5 leading-tight">{opt.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {error && (
                <div className="mt-4 p-3 rounded-lg bg-crypto-danger/10 border border-crypto-danger/20 text-sm text-crypto-danger">
                    {error}
                </div>
            )}

            <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={prevStep} className="flex-1">
                    Back
                </Button>
                {isFinalStep ? (
                    <Button onClick={submitSetup} loading={loading} className="flex-1">
                        🚀 Launch CryptoX
                    </Button>
                ) : (
                    <Button onClick={nextStep} className="flex-1">
                        Continue
                    </Button>
                )}
            </div>
        </div>
    );
};

export default StepBudget;
