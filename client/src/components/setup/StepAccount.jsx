import React from 'react';
import Input from '../common/Input';
import Button from '../common/Button';

const StepAccount = ({ formData, updateData, nextStep }) => {
    const canContinue = formData.username.length >= 3 && formData.password.length >= 8;

    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-crypto-heading">Create your account</h2>
                <p className="text-sm text-crypto-muted mt-1">This will be your login for the CryptoX dashboard.</p>
            </div>

            <div className="space-y-4">
                <Input
                    label="Username"
                    type="text"
                    required
                    autoComplete="username"
                    value={formData.username}
                    onChange={(e) => updateData({ username: e.target.value })}
                    placeholder="Choose a username"
                    hint="At least 3 characters, letters, numbers, and underscores only"
                />

                <Input
                    label="Password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={formData.password}
                    onChange={(e) => updateData({ password: e.target.value })}
                    placeholder="Choose a strong password"
                    hint="Minimum 8 characters"
                />
            </div>

            <div className="mt-8">
                <Button fullWidth onClick={nextStep} disabled={!canContinue}>
                    Continue
                </Button>
            </div>
        </div>
    );
};

export default StepAccount;
