import React from 'react';
import Input from '../common/Input';
import Button from '../common/Button';

const StepApiKey = ({ formData, updateData, nextStep, prevStep }) => {
    const hasKeys = formData.apiKey.trim() && formData.apiSecret.trim();

    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-crypto-heading">Connect Delta Exchange</h2>
                <p className="text-sm text-crypto-muted mt-1">
                    Your API keys are encrypted with AES-256 and never leave your server.
                </p>
            </div>

            <div className="space-y-4">
                <Input
                    label="Key Label"
                    value={formData.keyName}
                    onChange={(e) => updateData({ keyName: e.target.value })}
                    placeholder="e.g. Trading Bot Key"
                />

                <Input
                    label="API Key"
                    value={formData.apiKey}
                    onChange={(e) => updateData({ apiKey: e.target.value })}
                    placeholder="Paste your Delta API Key"
                    hint="Found in Delta Exchange → Settings → API Keys"
                />

                <Input
                    label="API Secret"
                    type="password"
                    value={formData.apiSecret}
                    onChange={(e) => updateData({ apiSecret: e.target.value })}
                    placeholder="Paste your Delta API Secret"
                />
            </div>

            {/* Info box */}
            <div className="mt-5 p-3 rounded-lg bg-crypto-info/10 border border-crypto-info/20 text-xs text-crypto-info">
                <strong>Tip:</strong> Use a <span className="font-semibold">read-only</span> API key for safety. CryptoX only needs read access to fetch balances and positions.
            </div>

            <div className="mt-8 flex gap-3">
                <Button variant="secondary" onClick={prevStep} className="flex-1">
                    Back
                </Button>
                <Button onClick={nextStep} className="flex-1" disabled={!hasKeys}>
                    {hasKeys ? 'Continue' : 'Skip for now'}
                </Button>
                {!hasKeys && (
                    <Button variant="ghost" onClick={nextStep} className="flex-1">
                        Skip
                    </Button>
                )}
            </div>
        </div>
    );
};

export default StepApiKey;
