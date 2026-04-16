import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── API URL ────────────────────────────────────────────────────────────────
const getApiUrl = async () => {
  try {
    const COMPUTER_IP = '172.20.10.2'; // Change to your computer's IP
    if (__DEV__) {
      if (Platform.OS === 'ios') return 'http://localhost:5000';
      if (Platform.OS === 'android') return 'http://10.0.2.2:5000';
    }
    return `http://${COMPUTER_IP}:5000`;
  } catch {
    return 'http://192.168.1.100:5000';
  }
};

// ─── Auth failure callback ───────────────────────────────────────────────────
// Register this in App.js to navigate to the login screen when tokens expire:
//
//   import { setAuthFailureCallback } from './services/api';
//
//   // Inside your root component, before rendering:
//   setAuthFailureCallback(() => {
//     // reset your auth state so the navigator switches to AuthScreen
//     setIsAuthenticated(false);
//   });
//
let _onAuthFailure = null;
export const setAuthFailureCallback = (cb) => { _onAuthFailure = cb; };

const _signOut = async () => {
  await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']);
  if (_onAuthFailure) _onAuthFailure();
};

// ─── Instance management ─────────────────────────────────────────────────────
let apiInstance = null;
let isRefreshing = false;
let refreshPromise = null; // shared promise across concurrent 401s

const createApiInstance = async () => {
  const baseURL = await getApiUrl();
  console.log('[API] Base URL:', baseURL);

  const instance = axios.create({
    baseURL,
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
  });

  // ── Request: inject access token ──────────────────────────────────────────
  instance.interceptors.request.use(
    async (config) => {
      const token = await AsyncStorage.getItem('access_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error)
  );

  // ── Response: handle 401 with a single coordinated token refresh ──────────
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error.response?.status;

      // Not a 401 — propagate as-is
      if (status !== 401) return Promise.reject(error);

      // FIX: Avoid infinite refresh loop.
      // If the /api/auth/refresh endpoint itself returns 401, the token is
      // truly dead. Sign out immediately instead of retrying.
      if (error.config?.url?.includes('/api/auth/refresh')) {
        await _signOut();
        return Promise.reject(error);
      }

      // ── Deduplicate: only one refresh in flight at a time ───────────────
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = (async () => {
          try {
            const refreshToken = await AsyncStorage.getItem('refresh_token');
            if (!refreshToken) throw new Error('No refresh token stored');

            const res = await instance.post('/api/auth/refresh', {
              refresh_token: refreshToken,
            });

            if (!res.data?.success) throw new Error('Refresh unsuccessful');

            const { access_token, refresh_token: newRefresh } = res.data.session;
            await AsyncStorage.setItem('access_token', access_token);
            await AsyncStorage.setItem('refresh_token', newRefresh);
            console.log('[API] Token refreshed successfully');
            return access_token;
          } catch (err) {
            console.error('[API] Refresh failed — signing out:', err.message);
            await _signOut();
            throw err;
          } finally {
            // Reset so future requests can refresh again if needed
            isRefreshing = false;
            refreshPromise = null;
          }
        })();
      }

      // FIX: Race condition — capture the Promise *object* into a local
      // variable before awaiting. The `finally` block above sets
      // `refreshPromise = null` the moment the IIFE settles. If we wrote
      // `await refreshPromise` (the variable) here, by the time the
      // JS engine evaluates it the variable is already null, giving us
      // `await null` → undefined instead of the real token — which would
      // silently swallow the error and leave every concurrent caller stuck.
      const pendingRefresh = refreshPromise;

      try {
        const newToken = await pendingRefresh;
        if (newToken) {
          const retryConfig = {
            ...error.config,
            headers: {
              ...error.config.headers,
              Authorization: `Bearer ${newToken}`,
            },
          };
          return instance(retryConfig);
        }
      } catch (_) {
        // Refresh failed — _signOut() was already called inside the IIFE.
        // Just fall through to reject below.
      }

      return Promise.reject(error);
    }
  );

  return instance;
};

// ─── Public helpers ───────────────────────────────────────────────────────────
export const getApi = async () => {
  if (!apiInstance) apiInstance = await createApiInstance();
  return apiInstance;
};

// Convenience wrapper — callers don't need to await getApi() on every call
const api = {
  get:    async (...args) => (await getApi()).get(...args),
  post:   async (...args) => (await getApi()).post(...args),
  put:    async (...args) => (await getApi()).put(...args),
  delete: async (...args) => (await getApi()).delete(...args),
};

export default api;