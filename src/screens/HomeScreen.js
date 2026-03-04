import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Vibration,
  Dimensions,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { io } from 'socket.io-client';

import gestureService from '../services/GestureService';
import api from '../services/api';

const { width } = Dimensions.get('window');

const API_URL = Platform.select({
  ios: 'http://localhost:5000',
  android: 'http://10.0.2.2:5000',
});

const HomeScreen = ({ navigation }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [location, setLocation] = useState(null);
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [enabledGestures, setEnabledGestures] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const socketRef = useRef(null);

  useEffect(() => {
    loadUserData();
    setupLocation();
    setupSocket();
    
    // Initialize gesture service
    gestureService.initialize();
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      
      const userData = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('access_token');
      
      if (userData && token) {
        setUser(JSON.parse(userData));
        
        // Get profile from backend
        try {
          const response = await api.get('/api/user/profile');
          
          if (response.data.success) {
            setProfile(response.data.profile);
          }
        } catch (error) {
          console.error('Error loading profile:', error);
        }
        
        // Get gesture preferences
        try {
          const gesturesResponse = await api.get('/api/gesture-preferences');
          
          if (gesturesResponse.data.success) {
            const enabled = gesturesResponse.data.preferences
              .filter(g => g.enabled)
              .map(g => g.gesture_type);
            setEnabledGestures(enabled);
          }
        } catch (error) {
          console.error('Error loading gestures:', error);
        }
        
        // Get recent alerts
        try {
          const alertsResponse = await api.get('/api/emergency/alerts?limit=3');
          
          if (alertsResponse.data.success) {
            setRecentAlerts(alertsResponse.data.alerts);
          }
        } catch (error) {
          console.error('Error loading alerts:', error);
        }
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        const address = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        });
        
        setLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          address: address[0] ? `${address[0].street}, ${address[0].city}` : 'Unknown'
        });
      }
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const setupSocket = () => {
    socketRef.current = io(API_URL);
    
    // Authenticate socket connection
    const authenticateSocket = async () => {
      const token = await AsyncStorage.getItem('access_token');
      if (token) {
        socketRef.current.emit('authenticate', { token });
      }
    };
    
    authenticateSocket();
    
    socketRef.current.on('emergency_triggered', (data) => {
      if (data.user_id === user?.id) {
        Alert.alert('Emergency Alert Sent', 'Your emergency contacts have been notified');
        loadRecentAlerts();
      }
    });
    
    socketRef.current.on('alert_resolved', (data) => {
      if (data.user_id === user?.id) {
        loadRecentAlerts();
      }
    });
  };

  const loadRecentAlerts = async () => {
    try {
      const response = await api.get('/api/emergency/alerts?limit=3');
      
      if (response.data.success) {
        setRecentAlerts(response.data.alerts);
      }
    } catch (error) {
      console.error('Error loading recent alerts:', error);
    }
  };

  const triggerEmergency = async (triggerType) => {
    if (isEmergencyActive) return;
    
    setIsEmergencyActive(true);
    setCountdown(5);
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          sendEmergencyAlert(triggerType);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.vibrate([0, 500, 200, 500]);
    
    Alert.alert(
      'Emergency Alert',
      `Emergency will be triggered in 5 seconds. Tap CANCEL to abort.`,
      [
        {
          text: 'CANCEL',
          onPress: () => {
            clearInterval(countdownInterval);
            setIsEmergencyActive(false);
            setCountdown(0);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
          style: 'cancel'
        }
      ],
      { cancelable: false }
    );
  };

  const sendEmergencyAlert = async (triggerType) => {
    try {
      const locationData = await Location.getCurrentPositionAsync({});
      const address = await Location.reverseGeocodeAsync({
        latitude: locationData.coords.latitude,
        longitude: locationData.coords.longitude
      });
      
      const alertData = {
        trigger_type: triggerType,
        location: {
          lat: locationData.coords.latitude,
          lng: locationData.coords.longitude,
          address: address[0] ? `${address[0].street}, ${address[0].city}` : 'Unknown'
        }
      };
      
      const response = await api.post('/api/emergency/trigger', alertData);
      
      if (response.data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Vibration.vibrate([0, 1000, 200, 1000, 200, 1000]);
        
        Alert.alert(
          'Emergency Alert Sent',
          'Your emergency contacts have been notified with your location.',
          [{ text: 'OK', onPress: () => {
            setIsEmergencyActive(false);
            loadRecentAlerts();
          }}]
        );
      }
    } catch (error) {
      console.error('Error sending emergency alert:', error.response?.data || error.message);
      Alert.alert('Error', 'Failed to send emergency alert. Please try again.');
      setIsEmergencyActive(false);
    }
  };

  const handleManualTrigger = () => {
    triggerEmergency('manual');
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const getGestureIconName = (gesture) => {
    if (gesture.includes('volume')) return 'volume-up';
    if (gesture.includes('power')) return 'power-settings-new';
    if (gesture.includes('shake')) return 'vibration';
    if (gesture.includes('fall')) return 'personal-injury';
    if (gesture.includes('back')) return 'touch-app';
    if (gesture.includes('screen')) return 'screen-lock-portrait';
    return 'gesture';
  };

  const getAlertStatusIconName = (status) => {
    switch (status) {
      case 'active': return 'pending';
      case 'resolved': return 'check-circle';
      default: return 'error';
    }
  };

  const getAlertStatusColor = (status) => {
    switch (status) {
      case 'active': return '#f39c12';
      case 'resolved': return '#2ecc71';
      default: return '#95a5a6';
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcomeText}>
          Welcome, {profile?.full_name || profile?.username || 'User'}!
        </Text>
        <View style={styles.gestureStatus}>
          <MaterialIcons name="check-circle" size={16} color="#2ecc71" />
          <Text style={styles.statusText}>
            {enabledGestures.length} gestures active
          </Text>
        </View>
      </View>
      
      {isEmergencyActive && (
        <View style={styles.countdownContainer}>
          <MaterialIcons name="warning" size={24} color="white" />
          <Text style={styles.countdownText}>Emergency in: {countdown}s</Text>
          <Text style={styles.countdownSubtext}>Tap CANCEL in alert to abort</Text>
        </View>
      )}
      
      <View style={styles.mainContent}>
        <TouchableOpacity
          style={styles.emergencyButton}
          onPress={handleManualTrigger}
          activeOpacity={0.7}
        >
          <MaterialIcons name="warning" size={80} color="white" />
          <Text style={styles.buttonText}>SOS</Text>
          <Text style={styles.buttonSubtext}>Tap for emergency</Text>
        </TouchableOpacity>
        
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <MaterialIcons name="notifications-active" size={24} color="#e74c3c" />
            <Text style={styles.statNumber}>{recentAlerts.length}</Text>
            <Text style={styles.statLabel}>Recent Alerts</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="touch-app" size={24} color="#e74c3c" />
            <Text style={styles.statNumber}>{enabledGestures.length}</Text>
            <Text style={styles.statLabel}>Active Gestures</Text>
          </View>
        </View>
        
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="gesture" size={20} color="#333" />
            <Text style={styles.sectionTitle}>Active Gestures</Text>
          </View>
          <View style={styles.gestureGrid}>
            {enabledGestures.slice(0, 6).map((gesture, index) => (
              <View key={index} style={styles.gestureItem}>
                <MaterialIcons 
                  name={getGestureIconName(gesture)}
                  size={28} 
                  color="#e74c3c" 
                />
                <Text style={styles.gestureLabel}>
                  {gesture.replace(/_/g, ' ')}
                </Text>
              </View>
            ))}
            {enabledGestures.length === 0 && (
              <View style={styles.noDataContainer}>
                <MaterialIcons name="gesture" size={32} color="#ccc" />
                <Text style={styles.noDataText}>
                  No gestures enabled. Go to Settings to enable them.
                </Text>
              </View>
            )}
          </View>
        </View>
        
        {recentAlerts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="history" size={20} color="#333" />
              <Text style={styles.sectionTitle}>Recent Alerts</Text>
            </View>
            {recentAlerts.map((alert, index) => (
              <View key={index} style={styles.alertItem}>
                <MaterialIcons 
                  name={getAlertStatusIconName(alert.status)}
                  size={24} 
                  color={getAlertStatusColor(alert.status)} 
                />
                <View style={styles.alertDetails}>
                  <Text style={styles.alertType}>
                    {alert.trigger_type.replace(/_/g, ' ')}
                  </Text>
                  <View style={styles.alertMeta}>
                    <MaterialIcons name="access-time" size={12} color="#999" />
                    <Text style={styles.alertTime}>
                      {formatDate(alert.timestamp)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
      
      {location && (
        <View style={styles.locationContainer}>
          <MaterialIcons name="location-on" size={20} color="#666" />
          <Text style={styles.locationText} numberOfLines={1}>
            {location.address}
          </Text>
          <MaterialIcons name="my-location" size={16} color="#2ecc71" />
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  welcomeText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  gestureStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  statusText: {
    marginLeft: 5,
    fontSize: 14,
    color: '#666',
  },
  countdownContainer: {
    backgroundColor: '#e74c3c',
    padding: 15,
    alignItems: 'center',
  },
  countdownText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  countdownSubtext: {
    color: 'white',
    fontSize: 12,
    marginTop: 5,
  },
  mainContent: {
    padding: 20,
  },
  emergencyButton: {
    width: width * 0.6,
    height: width * 0.6,
    borderRadius: width * 0.3,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 30,
    elevation: 5,
  },
  buttonText: {
    color: 'white',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 10,
  },
  buttonSubtext: {
    color: 'white',
    fontSize: 14,
    marginTop: 5,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 30,
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 120,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginTop: 5,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  gestureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
  },
  gestureItem: {
    width: '33.33%',
    alignItems: 'center',
    marginBottom: 15,
    padding: 5,
  },
  gestureLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 5,
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  alertDetails: {
    marginLeft: 12,
    flex: 1,
  },
  alertType: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    textTransform: 'capitalize',
  },
  alertMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  alertTime: {
    fontSize: 12,
    color: '#999',
    marginLeft: 4,
  },
  noDataContainer: {
    width: '100%',
    alignItems: 'center',
    padding: 20,
  },
  noDataText: {
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 12,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  locationText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
});

export default HomeScreen;