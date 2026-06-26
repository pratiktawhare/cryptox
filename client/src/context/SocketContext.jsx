/**
 * SocketContext.jsx
 *
 * Provides a single shared Socket.IO connection to the entire app.
 * Components call useSocket() to get { socket, connected }.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SOCKET_URL =
    typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : 'http://localhost:3001';

const SocketContext = createContext({ socket: null, connected: false });

export function SocketProvider({ children }) {
    const { user } = useAuth();
    const [socket,    setSocket]    = useState(null);
    const [connected, setConnected] = useState(false);

    // Create once on mount
    useEffect(() => {
        const s = io(SOCKET_URL, {
            withCredentials: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 2000,
        });
        setSocket(s);
        s.on('connect',    () => setConnected(true));
        s.on('disconnect', () => setConnected(false));
        return () => { s.disconnect(); };
    }, []);

    // Join user room when user or socket changes
    useEffect(() => {
        if (!socket || !user) return;
        const userId = user._id || user.id;
        if (userId) {
            if (socket.connected) {
                socket.emit('join_user_room', userId);
            } else {
                socket.once('connect', () => socket.emit('join_user_room', userId));
            }
        }
    }, [socket, user]);

    return (
        <SocketContext.Provider value={{ socket, connected }}>
            {children}
        </SocketContext.Provider>
    );
}

export const useSocket = () => useContext(SocketContext);