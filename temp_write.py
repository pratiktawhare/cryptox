content = '''import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../services/api';
import TradeConfirmDialog from '../components/trading/TradeConfirmDialog';
import NotificationBell from '../components/common/NotificationBell';
import MobileBottomNav from '../components/layout/MobileBottomNav';

const SOCKET_URL = import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\\/api\\/?$/, '')
    : (typeof window !== 'undefined'
        ? window.location.protocol + '//' + window.location.hostname + ':3001'
        : 'http://localhost:3001');
'''
with open('d:/Projects/cryptox/client/src/pages/signals_part1.txt', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
