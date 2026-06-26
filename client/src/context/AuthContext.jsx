import { createContext, useState, useEffect, useContext } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isInitialized, setIsInitialized] = useState(true);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            // 1. Check if app is initialized at all
            const statusRes = await api.get('/setup/status');
            setIsInitialized(statusRes.data.initialized);

            // 2. If initialized, check if user is logged in
            if (statusRes.data.initialized) {
                try {
                    const meRes = await api.get('/auth/me');
                    setUser(meRes.data.user);
                } catch (err) {
                    localStorage.removeItem('cryptox_token');
                    setUser(null); // Not logged in
                }
            }
        } catch (error) {
            console.error('Failed to check auth status:', error);
        } finally {
            setLoading(false);
        }
    };

    const login = async (username, password) => {
        const res = await api.post('/auth/login', { username, password });
        if (res.data.token) {
            localStorage.setItem('cryptox_token', res.data.token);
        }
        setUser(res.data.user);
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout');
        } catch (e) { /* ignore network error on logout */ }
        localStorage.removeItem('cryptox_token');
        setUser(null);
    };

    const finishSetup = (userData, token) => {
        if (token) {
            localStorage.setItem('cryptox_token', token);
        }
        setIsInitialized(true);
        setUser(userData);
    };

    return (
        <AuthContext.Provider value={{ user, loading, isInitialized, login, logout, finishSetup }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
