import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { TradingModeProvider } from './context/TradingModeContext';
import { SocketProvider } from './context/SocketContext';

import Login from './pages/Login';
import SetupWizard from './pages/SetupWizard';
import Dashboard from './pages/Dashboard';
import Markets from './pages/Markets';
import Signals from './pages/Signals';
import Positions from './pages/Positions';
import Analytics from './pages/Analytics';

function ProtectedRoute({ children }) {
    const { user, loading, isInitialized } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-crypto-bg">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-crypto-primary/10 flex items-center justify-center mb-1">
                        <svg className="w-5 h-5 text-crypto-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                            <polyline points="16 7 22 7 22 13" />
                        </svg>
                    </div>
                    <svg className="animate-spin h-5 w-5 text-crypto-primary" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-xs text-crypto-muted">Loading CryptoX…</p>
                </div>
            </div>
        );
    }

    if (!isInitialized) {
        return <Navigate to="/setup" replace />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

function AppRoutes() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<SetupWizard />} />
            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <Dashboard />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/markets"
                element={
                    <ProtectedRoute>
                        <Markets />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/signals"
                element={
                    <ProtectedRoute>
                        <Signals />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/positions"
                element={
                    <ProtectedRoute>
                        <Positions />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/analytics"
                element={
                    <ProtectedRoute>
                        <Analytics />
                    </ProtectedRoute>
                }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <SocketProvider>
                    <TradingModeProvider>
                        <BrowserRouter>
                            <div className="min-h-screen">
                                <AppRoutes />
                            </div>
                        </BrowserRouter>
                    </TradingModeProvider>
                </SocketProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}

export default App;
