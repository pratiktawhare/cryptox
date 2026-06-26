import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import Button from '../common/Button';
import Input from '../common/Input';

const AiPreferencesManager = () => {
    const [preferences, setPreferences] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Inputs
    const [aiProvider, setAiProvider] = useState('groq');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [deepseekApiKey, setDeepseekApiKey] = useState('');
    const [useCustomGroqKey, setUseCustomGroqKey] = useState(true);
    const [useCustomDeepseekKey, setUseCustomDeepseekKey] = useState(true);

    useEffect(() => {
        fetchPreferences();
    }, []);

    const fetchPreferences = async () => {
        try {
            const res = await api.get('/profile/preferences');
            const prefs = res.data.preferences;
            setPreferences(prefs);
            setAiProvider(prefs.aiProvider || 'groq');
            setUseCustomGroqKey(prefs.useCustomGroqKey !== false);
            setUseCustomDeepseekKey(prefs.useCustomDeepseekKey !== false);
        } catch (err) {
            console.error('Failed to fetch preferences', err);
            setError('Failed to load preferences.');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        setSuccess('');

        try {
            const payload = {
                aiProvider,
                useCustomGroqKey,
                useCustomDeepseekKey,
                riskTolerance: preferences?.riskTolerance,
                maxLeverage: preferences?.maxLeverage
            };

            // Only send keys if the user typed something in them
            if (groqApiKey.trim() !== '') {
                payload.groqApiKey = groqApiKey.trim();
            }
            if (deepseekApiKey.trim() !== '') {
                payload.deepseekApiKey = deepseekApiKey.trim();
            }

            const res = await api.patch('/profile/preferences', payload);
            setPreferences(res.data.preferences);
            setGroqApiKey('');
            setDeepseekApiKey('');
            setSuccess('AI preferences updated successfully!');
            setTimeout(() => setSuccess(''), 4000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

    const handleClearKey = async (provider) => {
        if (!window.confirm(`Are you sure you want to delete your saved ${provider === 'groq' ? 'Groq' : 'DeepSeek'} API key from the database?`)) {
            return;
        }
        
        setSaving(true);
        setError('');
        setSuccess('');

        try {
            const payload = {
                [provider === 'groq' ? 'groqApiKey' : 'deepseekApiKey']: ''
            };
            const res = await api.patch('/profile/preferences', payload);
            setPreferences(res.data.preferences);
            setSuccess(`Custom ${provider === 'groq' ? 'Groq' : 'DeepSeek'} API key deleted.`);
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to clear API key.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-crypto-card border border-crypto-border rounded-xl p-8 text-center animate-pulse">
                <div className="h-4 bg-crypto-border rounded w-1/3 mx-auto mb-4"></div>
                <div className="h-10 bg-crypto-border rounded mb-3"></div>
                <div className="h-10 bg-crypto-border rounded"></div>
            </div>
        );
    }

    const groqKeyActive = preferences?.hasGroqKey && useCustomGroqKey;
    const deepseekKeyActive = preferences?.hasDeepseekKey && useCustomDeepseekKey;

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="px-5 py-4 border-b border-crypto-border">
                <h3 className="text-sm font-semibold text-crypto-heading font-bold">AI Assistant Settings</h3>
                <p className="text-xs text-crypto-muted mt-0.5">Configure which AI model and API keys to use for market scanning and signals</p>
            </div>

            <form onSubmit={handleSave} className="px-5 py-5 space-y-5">
                {/* Provider Selection */}
                <div>
                    <label className="block text-xs font-semibold text-crypto-muted uppercase tracking-wider mb-2.5">
                        Active AI Model Provider
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        {/* Groq Card */}
                        <button
                            type="button"
                            onClick={() => setAiProvider('groq')}
                            className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center transition-all duration-200 cursor-pointer ${
                                aiProvider === 'groq'
                                    ? 'bg-crypto-primary/10 border-crypto-primary text-crypto-primary shadow-sm'
                                    : 'bg-crypto-bg border-crypto-border text-crypto-muted hover:border-crypto-primary/30 hover:text-crypto-heading'
                            }`}
                        >
                            <span className="text-sm font-bold block">Groq Cloud</span>
                            <span className="text-[10px] opacity-75 mt-0.5">Llama-3.3-70b-versatile (Fast)</span>
                            {groqKeyActive ? (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-semibold">Custom Key Active</span>
                            ) : (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-crypto-bg-subtle text-crypto-muted border border-crypto-border rounded font-semibold">Using System Default</span>
                            )}
                        </button>

                        {/* DeepSeek Card */}
                        <button
                            type="button"
                            onClick={() => setAiProvider('deepseek')}
                            className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center transition-all duration-200 cursor-pointer ${
                                aiProvider === 'deepseek'
                                    ? 'bg-crypto-primary/10 border-crypto-primary text-crypto-primary shadow-sm'
                                    : 'bg-crypto-bg border-crypto-border text-crypto-muted hover:border-crypto-primary/30 hover:text-crypto-heading'
                            }`}
                        >
                            <span className="text-sm font-bold block">DeepSeek</span>
                            <span className="text-[10px] opacity-75 mt-0.5">deepseek-chat V3 (Accurate)</span>
                            {deepseekKeyActive ? (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-semibold">Custom Key Active</span>
                            ) : (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded font-semibold">
                                    {preferences?.hasDeepseekKey ? 'System Default (Custom Disabled)' : 'Key Required'}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* API Key Inputs */}
                <div className="space-y-4 pt-2 border-t border-crypto-border/40">
                    <label className="block text-xs font-semibold text-crypto-muted uppercase tracking-wider">
                        Configure Custom API Keys
                    </label>

                    {/* Groq Key Input */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-crypto-heading font-medium">Groq API Key (Optional)</span>
                            {preferences?.hasGroqKey && (
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-1 text-[10px] text-crypto-muted cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={useCustomGroqKey}
                                            onChange={(e) => setUseCustomGroqKey(e.target.checked)}
                                            className="w-3 h-3 rounded bg-crypto-input border-crypto-border text-crypto-primary focus:ring-crypto-primary/20 cursor-pointer"
                                        />
                                        Use Custom Key
                                    </label>
                                    <span className="text-[10px] text-crypto-border">|</span>
                                    <button
                                        type="button"
                                        onClick={() => handleClearKey('groq')}
                                        className="text-[10px] text-red-400 hover:text-red-300 font-semibold cursor-pointer"
                                    >
                                        Delete Saved Key
                                    </button>
                                </div>
                            )}
                        </div>
                        <Input
                            type="password"
                            value={groqApiKey}
                            onChange={(e) => setGroqApiKey(e.target.value)}
                            placeholder={preferences?.hasGroqKey ? '•••••••••••••••• (Saved)' : 'Enter custom Groq key to override system default'}
                        />
                    </div>

                    {/* DeepSeek Key Input */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-crypto-heading font-medium">DeepSeek API Key</span>
                            {preferences?.hasDeepseekKey && (
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-1 text-[10px] text-crypto-muted cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={useCustomDeepseekKey}
                                            onChange={(e) => setUseCustomDeepseekKey(e.target.checked)}
                                            className="w-3 h-3 rounded bg-crypto-input border-crypto-border text-crypto-primary focus:ring-crypto-primary/20 cursor-pointer"
                                        />
                                        Use Custom Key
                                    </label>
                                    <span className="text-[10px] text-crypto-border">|</span>
                                    <button
                                        type="button"
                                        onClick={() => handleClearKey('deepseek')}
                                        className="text-[10px] text-red-400 hover:text-red-300 font-semibold cursor-pointer"
                                    >
                                        Delete Saved Key
                                    </button>
                                </div>
                            )}
                        </div>
                        <Input
                            type="password"
                            value={deepseekApiKey}
                            onChange={(e) => setDeepseekApiKey(e.target.value)}
                            placeholder={preferences?.hasDeepseekKey ? '•••••••••••••••• (Saved)' : 'Enter your deepseek API key'}
                        />
                    </div>
                </div>

                {/* Messages */}
                {error && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 rounded-lg animate-fade-in">
                        ⚠ {error}
                    </div>
                )}
                {success && (
                    <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 rounded-lg animate-fade-in">
                        ✓ {success}
                    </div>
                )}

                {/* Save Button */}
                <div className="pt-2 border-t border-crypto-border/40">
                    <Button
                        type="submit"
                        disabled={saving}
                        className="w-full flex justify-center py-2.5 text-sm font-bold cursor-pointer"
                    >
                        {saving ? 'Saving preferences…' : 'Save AI Preferences'}
                    </Button>
                </div>
            </form>
        </div>
    );
};

export default AiPreferencesManager;
