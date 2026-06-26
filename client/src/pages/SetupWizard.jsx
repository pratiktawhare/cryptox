import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ThemeToggle from '../components/layout/ThemeToggle';
import StepAccount from '../components/setup/StepAccount';
import StepApiKey from '../components/setup/StepApiKey';
import StepBudget from '../components/setup/StepBudget';

// Phase 4: Coins step removed — ALL 50+ coins always accessible
const steps = [
    { num: 1, label: 'Account' },
    { num: 2, label: 'API Keys' },
    { num: 3, label: 'Budget' },
];

const SetupWizard = () => {
    const navigate = useNavigate();
    const { finishSetup } = useAuth();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        username: '',
        password: '',
        apiKey: '',
        apiSecret: '',
        keyName: 'Delta Key',
        totalBudget: '',
        budgetCurrency: 'INR',
        maxLeverage: 10,
        riskTolerance: 'medium',
    });

    const updateData = (partial) => setFormData((prev) => ({ ...prev, ...partial }));
    const nextStep = () => setStep((s) => Math.min(s + 1, 3));
    const prevStep = () => setStep((s) => Math.max(s - 1, 1));

    const submitSetup = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.post('/setup/initialize', formData);
            finishSetup(res.data.user);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Setup failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const renderStep = () => {
        switch (step) {
            case 1: return <StepAccount formData={formData} updateData={updateData} nextStep={nextStep} />;
            case 2: return <StepApiKey formData={formData} updateData={updateData} nextStep={nextStep} prevStep={prevStep} />;
            case 3: return <StepBudget formData={formData} updateData={updateData} prevStep={prevStep} submitSetup={submitSetup} loading={loading} error={error} isFinalStep />;
            default: return null;
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-crypto-bg" />
            <div className="absolute inset-0 opacity-20">
                <div className="absolute top-1/3 -left-32 w-80 h-80 bg-crypto-primary/20 rounded-full blur-3xl" />
                <div className="absolute bottom-1/3 -right-32 w-96 h-96 bg-crypto-info/15 rounded-full blur-3xl" />
            </div>

            {/* Theme toggle */}
            <div className="absolute top-6 right-6 z-10">
                <ThemeToggle />
            </div>

            {/* Card */}
            <div className="relative z-10 w-full max-w-md mx-4 animate-fade-in">
                <div className="glass rounded-2xl border border-crypto-border p-8" style={{ boxShadow: 'var(--crypto-shadow-lg)' }}>
                    {/* Logo + title */}
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-8 h-8 rounded-lg bg-crypto-primary/10 flex items-center justify-center">
                            <svg className="w-4.5 h-4.5 text-crypto-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                                <polyline points="16 7 22 7 22 13" />
                            </svg>
                        </div>
                        <span className="text-lg font-bold text-crypto-heading tracking-tight">CryptoX Setup</span>
                    </div>

                    {/* Progress */}
                    <div className="mb-8">
                        <div className="flex justify-between items-center relative">
                            {/* Track background */}
                            <div className="absolute left-4 right-4 top-1/2 h-0.5 bg-crypto-border -translate-y-1/2 z-0" />
                            {/* Track fill */}
                            <div
                                className="absolute left-4 top-1/2 h-0.5 bg-crypto-primary -translate-y-1/2 z-0 transition-all duration-500"
                                style={{ width: `calc(${((step - 1) / 2) * 100}% - 16px)` }}
                            />

                            {steps.map(({ num }) => (
                                <div
                                    key={num}
                                    className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                                        step > num
                                            ? 'bg-crypto-primary border-crypto-primary text-white'
                                            : step === num
                                                ? 'bg-crypto-card border-crypto-primary text-crypto-primary shadow-md'
                                                : 'bg-crypto-card border-crypto-border text-crypto-muted'
                                    }`}
                                >
                                    {step > num ? (
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : num}
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-between mt-2">
                            {steps.map(({ num, label }) => (
                                <span key={num} className={`text-[10px] font-medium transition-colors ${
                                    step >= num ? 'text-crypto-heading' : 'text-crypto-muted'
                                }`}>
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Content */}
                    {renderStep()}
                </div>
            </div>
        </div>
    );
};

export default SetupWizard;
