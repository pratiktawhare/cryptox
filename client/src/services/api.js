import axios from 'axios';

// Use VITE_API_URL in production (set in Vercel dashboard).
// Falls back to localhost:3001 for local development.
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
    baseURL: BACKEND_URL,
    withCredentials: true, // Send cookies (JWT) with every request
    timeout: 15000,        // 15s timeout — prevents hanging requests
});

let lastRequestTime = Date.now();

// Request interceptor — attach JWT from localStorage
api.interceptors.request.use(
    (config) => {
        // Track the last request time for keep-alive check.
        // We skip updating the timestamp for the keep-alive health check itself.
        const isHealthCheck = config.url && (config.url.endsWith('/health') || config.url === 'health');
        if (!isHealthCheck) {
            lastRequestTime = Date.now();
        }

        const token = localStorage.getItem('cryptox_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — handle auth errors globally
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Dispatch event so AuthContext can react (e.g., redirect to login)
            window.dispatchEvent(new CustomEvent('cryptox:unauthorized'));
        }
        return Promise.reject(error);
    }
);

// Keep-alive mechanism: sends a small health check request every 25 minutes
// if no other request has been sent to the backend in that time.
const KEEPALIVE_INTERVAL = 25 * 60 * 1000; // 25 minutes
setInterval(() => {
    const now = Date.now();
    if (now - lastRequestTime >= KEEPALIVE_INTERVAL) {
        lastRequestTime = now;
        api.get('/health').catch((err) => {
            console.warn('Keep-alive ping failed (backend may be down or starting up):', err.message);
        });
    }
}, 60 * 1000); // Check every 60 seconds

export default api;
