import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import Button from '../common/Button';
import Input from '../common/Input';

const ApiKeyManager = () => {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    // Form state
    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [formError, setFormError] = useState('');

    useEffect(() => { fetchKeys(); }, []);

    const fetchKeys = async () => {
        try {
            const res = await api.get('/profile/keys');
            setKeys(res.data.keys);
        } catch (err) {
            console.error('Failed to fetch keys', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddKey = async (e) => {
        e.preventDefault();
        setSaving(true);
        setFormError('');

        try {
            const res = await api.post('/profile/keys', { name, apiKey, apiSecret, exchange: 'delta' });
            setKeys([res.data.key, ...keys]);
            setName('');
            setApiKey('');
            setApiSecret('');
            setShowForm(false);
        } catch (err) {
            setFormError(err.response?.data?.error || 'Failed to add key');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        setDeletingId(id);
        try {
            await api.delete(`/profile/keys/${id}`);
            setKeys(keys.filter((k) => k._id !== id));
        } catch (err) {
            console.error('Failed to delete key', err);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="bg-crypto-card border border-crypto-border rounded-xl overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="px-5 py-4 border-b border-crypto-border flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-crypto-heading">API Keys</h3>
                    <p className="text-xs text-crypto-muted mt-0.5">Manage your Delta Exchange API credentials</p>
                </div>
                {!showForm && (
                    <Button size="sm" onClick={() => setShowForm(true)}>
                        + Add Key
                    </Button>
                )}
            </div>

            {/* Add key form */}
            {showForm && (
                <div className="px-5 py-5 border-b border-crypto-border bg-crypto-bg-subtle/50 animate-fade-in">
                    <form onSubmit={handleAddKey} className="space-y-4">
                        <Input
                            label="Key Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Trading Bot Key"
                            required
                        />
                        <Input
                            label="API Key"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Paste your Delta API Key"
                            required
                        />
                        <Input
                            label="API Secret"
                            type="password"
                            value={apiSecret}
                            onChange={(e) => setApiSecret(e.target.value)}
                            placeholder="Paste your Delta API Secret"
                            required
                        />

                        {formError && (
                            <div className="text-xs text-crypto-danger bg-crypto-danger/10 border border-crypto-danger/20 px-3 py-2 rounded-lg">
                                {formError}
                            </div>
                        )}

                        <div className="flex gap-2 pt-1">
                            <Button type="submit" size="sm" loading={saving}>
                                Save & Test
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => { setShowForm(false); setFormError(''); }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            {/* Keys list */}
            <div className="divide-y divide-crypto-border/50">
                {loading ? (
                    <div className="px-5 py-8 text-center">
                        <div className="w-5 h-5 border-2 border-crypto-primary border-t-transparent rounded-full animate-spin mx-auto" />
                    </div>
                ) : keys.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-crypto-primary/10 mb-3">
                            <svg className="w-5 h-5 text-crypto-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                            </svg>
                        </div>
                        <p className="text-sm text-crypto-muted">No API keys yet. Click "Add Key" to connect your exchange.</p>
                    </div>
                ) : (
                    keys.map((k) => (
                        <div key={k._id} className="px-5 py-4 flex items-center justify-between hover:bg-crypto-card-hover transition-colors group">
                            <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${k.isActive ? 'bg-crypto-success' : 'bg-crypto-muted'}`} />
                                <div>
                                    <div className="text-sm font-medium text-crypto-heading">{k.name}</div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-crypto-muted font-mono">{k.maskedKey}</span>
                                        <span className="text-[10px] text-crypto-muted uppercase">{k.exchange}</span>
                                        {k.testResult === 'success' && (
                                            <span className="inline-flex items-center gap-0.5 text-[10px] text-crypto-success font-medium">
                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                </svg>
                                                Verified
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <Button
                                variant="danger"
                                size="sm"
                                loading={deletingId === k._id}
                                onClick={() => handleDelete(k._id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                Delete
                            </Button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default ApiKeyManager;
