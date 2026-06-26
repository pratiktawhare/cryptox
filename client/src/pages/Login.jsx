import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Button from '../components/common/Button';
import Input from '../components/common/Input';
import ThemeToggle from '../components/layout/ThemeToggle';

const Login = () => {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [shake, setShake] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(username, password);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
            setShake(true);
            setTimeout(() => setShake(false), 500);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
            {/* Animated background */}
            <div className="absolute inset-0 bg-crypto-bg" />
            <div className="absolute inset-0 opacity-30">
                <div className="absolute top-1/4 -left-20 w-72 h-72 bg-crypto-primary/20 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-crypto-info/15 rounded-full blur-3xl" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-crypto-primary/5 rounded-full blur-3xl" />
            </div>

            {/* Theme toggle */}
            <div className="absolute top-6 right-6 z-10">
                <ThemeToggle />
            </div>

            {/* Login card */}
            <div className={`relative z-10 w-full max-w-md mx-4 animate-fade-in-scale ${shake ? 'animate-shake' : ''}`}>
                <div className="glass rounded-2xl border border-crypto-border p-8 md:p-10" style={{ boxShadow: 'var(--crypto-shadow-lg)' }}>
                    {/* Logo */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-crypto-primary/10 mb-4">
                            <svg className="w-7 h-7 text-crypto-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                                <polyline points="16 7 22 7 22 13" />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-crypto-heading tracking-tight">
                            Welcome back
                        </h1>
                        <p className="mt-1.5 text-sm text-crypto-muted">
                            Sign in to your CryptoX dashboard
                        </p>
                    </div>

                    {/* Form */}
                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <Input
                            label="Username"
                            type="text"
                            required
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter your username"
                            disabled={loading}
                        />

                        <Input
                            label="Password"
                            type="password"
                            required
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            disabled={loading}
                        />

                        {error && (
                            <div className="flex items-center gap-2 text-sm text-crypto-danger bg-crypto-danger/10 border border-crypto-danger/20 px-4 py-3 rounded-lg animate-fade-in">
                                <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            fullWidth
                            size="lg"
                            loading={loading}
                        >
                            Sign in to Dashboard
                        </Button>
                    </form>

                    <p className="mt-6 text-center text-xs text-crypto-muted">
                        Protected by AES-256 encryption & JWT authentication
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
