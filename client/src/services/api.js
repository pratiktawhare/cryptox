import axios from 'axios';

// Use VITE_API_URL in production (set in Vercel dashboard).
// Falls back to localhost:3001 for local development.
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
    baseURL: BACKEND_URL,
    withCredentials: true, // Send cookies (JWT) with every request
    timeout: 15000,        // 15s timeout — prevents hanging requests
});

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

export default api;
