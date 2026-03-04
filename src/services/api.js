import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert } from 'react-native';

// Configure API URL based on platform
const API_URL = Platform.select({
  ios: 'http://localhost:5000',
  android: 'http://10.0.2.2:5000',
  // For physical device, use your computer's IP
  // default: 'http://192.168.1.x:5000'
});

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('Token added to request:', token.substring(0, 20) + '...');
      } else {
        console.log('No token found for request:', config.url);
      }
    } catch (error) {
      console.error('Error adding token to request:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    console.error('API Error:', error.response?.status, error.response?.data || error.message);
    
    // Handle 401 Unauthorized errors (token expired)
    if (error.response?.status === 401) {
      try {
        // Try to refresh token
        const refreshToken = await AsyncStorage.getItem('refresh_token');
        if (refreshToken) {
          try {
            const refreshResponse = await axios.post(`${API_URL}/api/auth/refresh`, {
              refresh_token: refreshToken
            });
            
            if (refreshResponse.data.success) {
              // Save new tokens
              await AsyncStorage.setItem('access_token', refreshResponse.data.session.access_token);
              await AsyncStorage.setItem('refresh_token', refreshResponse.data.session.refresh_token);
              
              // Retry the original request with new token
              error.config.headers.Authorization = `Bearer ${refreshResponse.data.session.access_token}`;
              return axios(error.config);
            }
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            // Clear tokens and redirect to login
            await AsyncStorage.removeItem('access_token');
            await AsyncStorage.removeItem('refresh_token');
            await AsyncStorage.removeItem('user');
            
            // Show alert to user
            Alert.alert(
              'Session Expired',
              'Please login again',
              [{ text: 'OK' }]
            );
          }
        }
      } catch (refreshError) {
        console.error('Token refresh error:', refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default api;