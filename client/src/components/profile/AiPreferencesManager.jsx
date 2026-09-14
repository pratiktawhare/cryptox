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
    const [deepseekApiKey, setDeepseekApiKey] = useState('');
    const [useCustomGroqKey, setUseCustomGroqKey] = useState(true);
    const [useCustomDeepseekKey, setUseCustomDeepseekKey] = useState(true);

    // Groq Multi-Key Pool
    const [groqKeys, setGroqKeys] = useState([]);
    const [rotationIntervalMin, setRotationIntervalMin] = useState(15);
    const [newKeyInput, setNewKeyInput] = useState('');
    const [newNicknameInput, setNewNicknameInput] = useState('');
    const [addingKey, setAddingKey] = useState(false);

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
            setGroqKeys(prefs.groqKeys || []);
            setRotationIntervalMin(prefs.groqRotationIntervalMin !== undefined ? prefs.groqRotationIntervalMin : 15);
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
                groqRotationIntervalMin: rotationIntervalMin,
                riskTolerance: preferences?.riskTolerance,
                maxLeverage: preferences?.maxLeverage
            };

            if (deepseekApiKey.trim() !== '') {
                payload.deepseekApiKey = deepseekApiKey.trim();
            }

            const res = await api.patch('/profile/preferences', payload);
            setPreferences(res.data.preferences);
            setDeepseekApiKey('');
            setSuccess('AI preferences updated successfully!');
            setTimeout(() => setSuccess(''), 4000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

    const handleAddGroqKey = async (e) => {
        e.preventDefault();
        if (!newKeyInput.trim()) {
            setError('Please enter a Groq API key.');
            return;
        }

        setAddingKey(true);
        setError('');
        setSuccess('');

        try {
            const res = await api.post('/profile/groq-keys', {
                apiKey: newKeyInput.trim(),
                nickname: newNicknameInput.trim() || undefined
            });
            setGroqKeys(res.data.keys || []);
            setNewKeyInput('');
            setNewNicknameInput('');
            setSuccess('Groq API key added to rotation pool!');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add Groq key.');
        } finally {
            setAddingKey(false);
        }
    };

    const handleDeleteGroqKey = async (id) => {
        if (!window.confirm('Are you sure you want to remove this Groq API key from rotation?')) {
            return;
        }

        try {
            const res = await api.delete(`/profile/groq-keys/${id}`);
            setGroqKeys(res.data.keys || []);
            setSuccess('Groq API key removed from pool.');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to remove Groq key.');
        }
    };

    const handleToggleGroqKey = async (id) => {
        try {
            const res = await api.patch(`/profile/groq-keys/${id}/toggle`);
            setGroqKeys(res.data.keys || []);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to toggle Groq key.');
        }
    };

    const handleIntervalChange = async (val) => {
        const minutes = parseInt(val, 10);
        setRotationIntervalMin(minutes);
        try {
            await api.patch('/profile/groq-rotation', { intervalMin: minutes });
            setSuccess(`Rotation interval updated to ${minutes === 0 ? 'Every Call' : `${minutes} mins`}!`);
            setTimeout(() => setSuccess(''), 2500);
        } catch (err) {
            setError('Failed to update rotation interval.');
        }
    };

    const handleClearKey = async (provider) => {
        if (!window.confirm(`Are you sure you want to delete your saved ${provider === 'deepseek' ? 'DeepSeek' : 'Groq'} API key?`)) {
            return;
        }
        
        setSaving(true);
        setError('');
        setSuccess('');

        try {
            const payload = {
                [provider === 'deepseek' ? 'deepseekApiKey' : 'groqApiKey']: ''
            };
            const res = await api.patch('/profile/preferences', payload);
            setPreferences(res.data.preferences);
            setSuccess(`Custom ${provider === 'deepseek' ? 'DeepSeek' : 'Groq'} API key cleared.`);
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

    const activeKeysCount = groqKeys.filter(k => k.isActive).length;
    const deepseekKeyActive = preferences?.hasDeepseekKey && useCustomDeepseekKey;

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="px-5 py-4 border-b border-crypto-border">
                <h3 className="text-sm font-semibold text-crypto-heading font-bold">AI Assistant Settings</h3>
                <p className="text-xs text-crypto-muted mt-0.5">Configure AI models, multi-key rotation, and API key pools for automated trading</p>
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
                            <span className="text-[10px] opacity-75 mt-0.5">gpt-oss-120b (Ultra Fast)</span>
                            <span className="text-[9px] opacity-60 mt-0.5">
                                {activeKeysCount > 0 ? `🔄 ${activeKeysCount} Key${activeKeysCount > 1 ? 's' : ''} in Rotation` : 'Single / Default Key'}
                            </span>
                            {activeKeysCount > 0 ? (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-semibold">
                                    {activeKeysCount} Active Key{activeKeysCount > 1 ? 's' : ''}
                                </span>
                            ) : (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-crypto-bg-subtle text-crypto-muted border border-crypto-border rounded font-semibold">
                                    System Default Key
                                </span>
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
                            <span className="text-[10px] opacity-75 mt-0.5">deepseek-chat V3</span>
                            {deepseekKeyActive ? (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-semibold">Custom Key Active</span>
                            ) : (
                                <span className="mt-2 text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded font-semibold">
                                    {preferences?.hasDeepseekKey ? 'Disabled' : 'Key Required'}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Groq Multi-Key Pool & Rotation Section */}
                {aiProvider === 'groq' && (
                    <div className="space-y-4 pt-3 border-t border-crypto-border/40">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                                <h4 className="text-xs font-bold text-crypto-heading uppercase tracking-wider flex items-center gap-1.5">
                                    <span>🔑</span> Groq API Key Pool & Account Rotation
                                </h4>
                                <p className="text-[11px] text-crypto-muted mt-0.5">
                                    Add multiple Groq account keys to rotate periodically and bypass rate limits
                                </p>
                            </div>

                            {/* Rotation Interval Selector */}
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-crypto-muted font-medium whitespace-nowrap">Rotate every:</span>
                                <select
                                    value={rotationIntervalMin}
                                    onChange={(e) => handleIntervalChange(e.target.value)}
                                    className="px-2.5 py-1 text-xs font-semibold bg-crypto-bg border border-crypto-border rounded-lg text-crypto-heading focus:border-crypto-primary focus:outline-none cursor-pointer"
                                >
                                    <option value={15}>15 Minutes</option>
                                    <option value={30}>30 Minutes</option>
                                    <option value={60}>60 Minutes</option>
                                    <option value={0}>Every Trade Scan</option>
                                </select>
                            </div>
                        </div>

                        {/* Keys Table / List */}
                        <div className="space-y-2">
                            {groqKeys.length === 0 ? (
                                <div className="p-4 rounded-xl bg-crypto-bg/50 border border-dashed border-crypto-border text-center">
                                    <p className="text-xs text-crypto-muted">No custom Groq keys added yet. The system is using the default key.</p>
                                    <p className="text-[10px] text-crypto-muted/70 mt-1">Add keys below from multiple Groq accounts to enable auto-rotation.</p>
                                </div>
                            ) : (
                                groqKeys.map((k, index) => (
                                    <div
                                        key={k._id || index}
                                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                            k.isActive
                                                ? 'bg-crypto-bg border-crypto-border hover:border-crypto-primary/30'
                                                : 'bg-crypto-bg/40 border-crypto-border/40 opacity-60'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="w-6 h-6 rounded-lg bg-crypto-card border border-crypto-border flex items-center justify-center text-[11px] font-bold text-crypto-muted">
                                                {index + 1}
                                            </span>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold text-crypto-heading">{k.nickname}</span>
                                                    {k.isActive ? (
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-crypto-bg-subtle text-crypto-muted border border-crypto-border">
                                                            Paused
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] font-mono text-crypto-muted mt-0.5">
                                                    {k.maskedKey}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleGroqKey(k._id)}
                                                className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-crypto-card border border-crypto-border hover:bg-crypto-bg-subtle text-crypto-muted hover:text-crypto-heading transition-colors cursor-pointer"
                                            >
                                                {k.isActive ? 'Pause' : 'Activate'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteGroqKey(k._id)}
                                                title="Delete key"
                                                className="p-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Add New Key Inline Form */}
                        <div className="p-3.5 rounded-xl bg-crypto-bg/40 border border-crypto-border space-y-3">
                            <span className="text-xs font-semibold text-crypto-heading flex items-center gap-1.5">
                                <span>➕</span> Add New Groq Account Key
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                <div className="sm:col-span-1">
                                    <Input
                                        type="text"
                                        placeholder="Account Nickname (e.g. Account 2)"
                                        value={newNicknameInput}
                                        onChange={(e) => setNewNicknameInput(e.target.value)}
                                        className="text-xs py-2"
                                    />
                                </div>
                                <div className="sm:col-span-2 flex gap-2">
                                    <Input
                                        type="password"
                                        placeholder="gsk_..."
                                        value={newKeyInput}
                                        onChange={(e) => setNewKeyInput(e.target.value)}
                                        className="text-xs py-2 flex-1"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddGroqKey}
                                        disabled={addingKey || !newKeyInput.trim()}
                                        className="px-4 py-2 bg-crypto-primary text-white text-xs font-semibold rounded-lg hover:bg-crypto-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                                    >
                                        {addingKey ? 'Adding…' : '+ Add Key'}
                                    </button>
                                </div>
                            </div>
                            <p className="text-[10px] text-crypto-muted">
                                💡 Tip: Groq free tier gives 6,000 TPM per account. By adding multiple account keys, CryptoX will rotate every {rotationIntervalMin === 0 ? 'trade scan' : `${rotationIntervalMin} minutes`} and immediately fail over if any key gets rate limited.
                            </p>
                        </div>
                    </div>
                )}

                {/* DeepSeek Key Section */}
                {aiProvider === 'deepseek' && (
                    <div className="space-y-4 pt-3 border-t border-crypto-border/40">
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
                )}

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
