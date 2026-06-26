/**
 * TradingModeContext.jsx
 *
 * Global context for the LIVE / PAPER trading mode toggle.
 *
 * Provides:
 *   mode          — 'live' | 'paper'
 *   isLive        — boolean shortcut
 *   isPaper       — boolean shortcut
 *   setMode(m)    — switch mode (persists to server + localStorage)
 *   loading       — true while fetching initial mode from server
 *
 * Usage:
 *   import { useTradingMode } from '../context/TradingModeContext';
 *   const { mode, isPaper, setMode } = useTradingMode();
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const TradingModeContext = createContext(null);

const LS_KEY = 'cryptox_trading_mode';

export function TradingModeProvider({ children }) {
    // Start with localStorage optimistically, then server corrects it
    const [mode, setModeState] = useState(() => localStorage.getItem(LS_KEY) || 'paper');
    const [loading, setLoading] = useState(true);

    // Always fetch from server on mount — server is source of truth
    useEffect(() => {
        api.get('/profile/mode')
            .then(res => {
                const serverMode = res.data?.mode || 'paper';
                setModeState(serverMode);
                localStorage.setItem(LS_KEY, serverMode); // keep in sync
            })
            .catch(() => {
                // Not logged in yet or server error — keep localStorage value
            })
            .finally(() => setLoading(false));
    }, []); // run once on mount

    const setMode = useCallback(async (newMode) => {
        if (!['live', 'paper'].includes(newMode)) return;
        setModeState(newMode);
        localStorage.setItem(LS_KEY, newMode);
        try {
            await api.patch('/profile/mode', { mode: newMode });
        } catch (e) {
            console.warn('[TradingMode] Failed to persist mode to server:', e.message);
        }
    }, []);

    const value = {
        mode,
        isLive:  mode === 'live',
        isPaper: mode === 'paper',
        setMode,
        loading,
    };

    return (
        <TradingModeContext.Provider value={value}>
            {children}
        </TradingModeContext.Provider>
    );
}

export function useTradingMode() {
    const ctx = useContext(TradingModeContext);
    if (!ctx) throw new Error('useTradingMode must be used inside TradingModeProvider');
    return ctx;
}

export default TradingModeContext;
