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
    const [expandedId,    setExpandedId]    = useState(null);

    const dropdownRef = useRef(null);
    const bellRef     = useRef(null);

    // ── Fetch list ────────────────────────────────────────────────────────────

    const fetchNotifications = useCallback(async (isInitial = false) => {
        if (!user) return;
        if (isInitial && notifications.length === 0) setLoading(true);
        try {
            const { data } = await api.get('/notifications');
            if (data.success) {
                setNotifications(data.notifications || []);
                setUnreadCount((data.notifications || []).filter(n => !n.isRead).length);
            }
        } catch { /* silent */ }
        finally { setLoading(false); }
    }, [user, notifications.length]);

    useEffect(() => { fetchNotifications(true); }, [fetchNotifications]);

    // Refresh when dropdown opens without wiping current list
    useEffect(() => { if (open) fetchNotifications(false); }, [open, fetchNotifications]);

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
                try {
                    const bNotif = new Notification(notif.title, { body: notif.message, icon: '/favicon.ico' });
                    bNotif.onclick = () => {
                        window.focus();
                        setOpen(true);
                    };
                } catch { /* ignore */ }
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

    async function clearAll() {
        try {
            await api.delete('/notifications/clear-all');
            setNotifications([]);
            setUnreadCount(0);
        } catch {
            setNotifications([]);
            setUnreadCount(0);
        }
    }

    function requestBrowserPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    const handleItemClick = (n) => {
        const nid = n.id || n._id;
        if (!n.isRead) markRead(nid);
        setExpandedId(prev => prev === nid ? null : nid);
    };

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            {/* Bell button */}
            <button
                ref={bellRef}
                onClick={() => setOpen(o => !o)}
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
                    className="fixed sm:absolute top-16 sm:top-12 left-4 right-4 sm:left-auto sm:right-0 w-[calc(100vw-2rem)] sm:w-[380px] bg-crypto-card border border-crypto-border rounded-2xl shadow-2xl overflow-hidden z-[9999]"
                    style={{
                        background: 'rgba(15,10,30,0.97)',
                        backdropFilter: 'blur(20px)',
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
                        {loading && notifications.length === 0 ? (
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
                                const isExpanded = expandedId === nid;
                                return (
                                    <div
                                        key={nid}
                                        onClick={() => handleItemClick(n)}
                                        style={{
                                            padding: '12px 16px',
                                            display: 'flex',
                                            gap: '12px',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                            cursor: 'pointer',
                                            background: n.isRead ? 'transparent' : 'rgba(167,139,250,0.06)',
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
                                                whiteSpace: isExpanded ? 'normal' : 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}>
                                                {n.title}
                                            </div>
                                            <div style={{
                                                fontSize: '12px',
                                                color: isExpanded ? '#cbd5e1' : '#64748b',
                                                lineHeight: 1.4,
                                                display: isExpanded ? 'block' : '-webkit-box',
                                                WebkitLineClamp: isExpanded ? 'unset' : 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden',
                                                wordBreak: 'break-word',
                                            }}>
                                                {n.message}
                                            </div>
                                            {isExpanded && n.signalId && (
                                                <a
                                                    href="/signals"
                                                    onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        marginTop: '6px',
                                                        fontSize: '11px',
                                                        color: '#a78bfa',
                                                        fontWeight: 600,
                                                        textDecoration: 'none',
                                                    }}
                                                >
                                                    View in Signals →
                                                </a>
                                            )}
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
                            borderTop: '1px solid rgba(167,139,250,0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}>
                            <button
                                onClick={markAllRead}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#a78bfa',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                }}
                            >
                                Mark all read
                            </button>
                            <button
                                onClick={clearAll}
                                style={{
                                    background: 'rgba(239,68,68,0.1)',
                                    border: '1px solid rgba(239,68,68,0.25)',
                                    borderRadius: '6px',
                                    color: '#f87171',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    padding: '4px 10px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                }}
                            >
                                Clear all
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