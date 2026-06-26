import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../../context/SocketContext';
import { useAuth } from '../../context/AuthContext';
import { playSound } from '../../utils/soundAlert';
import api from '../../services/api';

// ─── Formatters ──────────────────────────────────────────────────────────────

function timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date)) / 1000);
    if (s < 60)  return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function typeIcon(type, priority) {
    if (type === 'signal')   return priority === 'high' ? '🔥' : '📡';
    if (type === 'resolved') return '🎯';
    if (type === 'alert')    return '⚠️';
    return '📊';
}

function typeColor(type) {
    if (type === 'signal')   return '#a78bfa';
    if (type === 'resolved') return '#34d399';
    if (type === 'alert')    return '#fbbf24';
    return '#94a3b8';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NotificationBell() {
    const { user } = useAuth();
    const { socket } = useSocket();

    const [open,          setOpen]          = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount,   setUnreadCount]   = useState(0);
    const [loading,       setLoading]       = useState(false);
    const [soundEnabled,  setSoundEnabled]  = useState(true);

    const dropdownRef = useRef(null);
    const bellRef     = useRef(null);

    // ── Fetch list ────────────────────────────────────────────────────────────

    const fetchNotifications = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data } = await api.get('/notifications');
            if (data.success) {
                setNotifications(data.notifications || []);
                setUnreadCount((data.notifications || []).filter(n => !n.isRead).length);
            }
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, [user]);

    useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

    // Refresh when dropdown opens
    useEffect(() => { if (open) fetchNotifications(); }, [open, fetchNotifications]);

    // ── Socket.IO real-time push ──────────────────────────────────────────────

    useEffect(() => {
        if (!socket) return;

        const handleNotification = (notif) => {
            setNotifications(prev => [notif, ...prev].slice(0, 50));
            setUnreadCount(c => c + 1);

            // Play sound
            if (soundEnabled && notif.sound) {
                playSound(notif.sound);
            }

            // Browser native notification (if permission granted)
            if (Notification.permission === 'granted') {
                new Notification(notif.title, { body: notif.message, icon: '/favicon.ico' });
            }
        };

        socket.on('notification', handleNotification);
        return () => socket.off('notification', handleNotification);
    }, [socket, soundEnabled]);

    // ── Click outside to close ────────────────────────────────────────────────

    useEffect(() => {
        const handler = (e) => {
            if (
                dropdownRef.current && !dropdownRef.current.contains(e.target) &&
                bellRef.current      && !bellRef.current.contains(e.target)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Actions ───────────────────────────────────────────────────────────────

    async function markRead(id) {
        try {
            await api.patch(`/notifications/${id}/read`);
            setNotifications(prev => prev.map(n => n.id === id || n._id === id ? { ...n, isRead: true } : n));
            setUnreadCount(c => Math.max(0, c - 1));
        } catch { /* silent */ }
    }

    async function markAllRead() {
        try {
            await api.post('/notifications/mark-all-read');
            setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
            setUnreadCount(0);
        } catch { /* silent */ }
    }

    async function deleteOne(id) {
        try {
            await api.delete(`/notifications/${id}`);
            const n = notifications.find(x => (x.id || x._id) === id);
            setNotifications(prev => prev.filter(x => (x.id || x._id) !== id));
            if (n && !n.isRead) setUnreadCount(c => Math.max(0, c - 1));
        } catch { /* silent */ }
    }

    function requestBrowserPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            {/* Bell button */}
            <button
                ref={bellRef}
                onClick={() => { setOpen(o => !o); requestBrowserPermission(); }}
                title="Notifications"
                style={{
                    position: 'relative',
                    background: open ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(167,139,250,0.3)',
                    borderRadius: '10px',
                    width: '40px',
                    height: '40px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    color: '#fff',
                    fontSize: '18px',
                }}
            >
                🔔
                {unreadCount > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-4px',
                        background: '#ef4444',
                        color: '#fff',
                        borderRadius: '10px',
                        fontSize: '10px',
                        fontWeight: 700,
                        minWidth: '18px',
                        height: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 3px',
                        boxShadow: '0 0 0 2px rgba(0,0,0,0.8)',
                        animation: 'notifPulse 1.5s ease infinite',
                    }}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {open && (
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'absolute',
                        top: '48px',
                        right: 0,
                        width: '380px',
                        maxWidth: '95vw',
                        background: 'rgba(15,10,30,0.97)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(167,139,250,0.3)',
                        borderRadius: '16px',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                        zIndex: 9999,
                        overflow: 'hidden',
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(167,139,250,0.15)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>
                                Notifications
                            </span>
                            {unreadCount > 0 && (
                                <span style={{
                                    background: 'rgba(167,139,250,0.2)',
                                    color: '#a78bfa',
                                    borderRadius: '8px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '1px 7px',
                                }}>
                                    {unreadCount} new
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {/* Sound toggle */}
                            <button
                                onClick={() => setSoundEnabled(s => !s)}
                                title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    opacity: soundEnabled ? 1 : 0.4,
                                    padding: '2px',
                                }}
                            >
                                {soundEnabled ? '🔊' : '🔇'}
                            </button>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllRead}
                                    style={{
                                        background: 'rgba(167,139,250,0.15)',
                                        border: '1px solid rgba(167,139,250,0.3)',
                                        borderRadius: '8px',
                                        color: '#a78bfa',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        padding: '4px 10px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>
                    </div>

                    {/* List */}
                    <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                        {loading ? (
                            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                                Loading…
                            </div>
                        ) : notifications.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center' }}>
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔔</div>
                                <div style={{ color: '#64748b', fontSize: '14px' }}>No notifications yet</div>
                            </div>
                        ) : (
                            notifications.map(n => {
                                const nid = n.id || n._id;
                                return (
                                    <div
                                        key={nid}
                                        onClick={() => !n.isRead && markRead(nid)}
                                        style={{
                                            padding: '12px 16px',
                                            display: 'flex',
                                            gap: '12px',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                            cursor: n.isRead ? 'default' : 'pointer',
                                            background: n.isRead ? 'transparent' : 'rgba(167,139,250,0.04)',
                                            transition: 'background 0.2s',
                                        }}
                                    >
                                        {/* Icon */}
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '50%',
                                            background: `${typeColor(n.type)}22`,
                                            border: `1px solid ${typeColor(n.type)}55`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '16px',
                                            flexShrink: 0,
                                        }}>
                                            {typeIcon(n.type, n.priority)}
                                        </div>

                                        {/* Content */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: '13px',
                                                fontWeight: n.isRead ? 500 : 700,
                                                color: n.isRead ? '#94a3b8' : '#fff',
                                                marginBottom: '2px',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}>
                                                {n.title}
                                            </div>
                                            <div style={{
                                                fontSize: '12px',
                                                color: '#64748b',
                                                lineHeight: 1.4,
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden',
                                            }}>
                                                {n.message}
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>
                                                {timeAgo(n.createdAt)}
                                            </div>
                                        </div>

                                        {/* Unread dot + delete */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                                            {!n.isRead && (
                                                <div style={{
                                                    width: '8px',
                                                    height: '8px',
                                                    borderRadius: '50%',
                                                    background: '#a78bfa',
                                                    boxShadow: '0 0 6px #a78bfa',
                                                }} />
                                            )}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); deleteOne(nid); }}
                                                title="Dismiss"
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: '#475569',
                                                    cursor: 'pointer',
                                                    fontSize: '14px',
                                                    padding: '2px',
                                                    lineHeight: 1,
                                                    opacity: 0.6,
                                                }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                        <div style={{
                            padding: '10px 16px',
                            borderTop: '1px solid rgba(167,139,250,0.1)',
                            textAlign: 'center',
                        }}>
                            <button
                                onClick={() => {
                                    setNotifications([]);
                                    setUnreadCount(0);
                                    setOpen(false);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#475569',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                }}
                            >
                                Clear all (local)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Keyframe for badge pulse */}
            <style>{`
                @keyframes notifPulse {
                    0%, 100% { transform: scale(1); }
                    50%       { transform: scale(1.15); }
                }
            `}</style>
        </div>
    );
}