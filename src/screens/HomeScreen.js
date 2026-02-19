import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Vibration,
  Dimensions,
  AppState,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { io } from 'socket.io-client';
import axios from 'axios';
import { supabase } from '../services/supabase';

const { width } = Dimensions.get('window');

const HomeScreen = ({ navigation }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [location, setLocation] = useState(null);
  const [accelerometerData, setAccelerometerData] = useState({ x: 0, y: 0, z: 0 });
  const [shakeCount, setShakeCount] = useState(0);
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [enabledGestures, setEnabledGestures] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const socketRef = useRef(null);
  const lastShakeTime = useRef(0);
  const appState = useRef(AppState.currentState);
  
  const API_URL = 'http://localhost:5000'; // Change to your backend URL

  useEffect(() => {
    loadUserData();
    setupLocation();
    setupSensors();
    setupSocket();
    
    const subscription = Accelerometer.addListener(handleAccelerometerData);
    Accelerometer.setUpdateInterval(100);
    
    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
      appStateSubscription.remove();
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      
      // Get current user from Supabase
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (authUser) {
        // Get profile from Supabase
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .single();
        
        if (profileError) throw profileError;
        
        setUser(authUser);
        setProfile(profileData);
        
        // Get enabled gestures
        const { data: gesturesData, error: gesturesError } = await supabase
          .from('gesture_preferences')
          .select('*')
          .eq('user_id', authUser.id)
          .eq('enabled', true);
        
        if (!gesturesError) {
          setEnabledGestures(gesturesData.map(g => g.gesture_type));
        }
        
        // Get recent alerts
        const { data: alertsData, error: alertsError } = await supabase
          .from('emergency_alerts')
          .select('*')
          .eq('user_id', authUser.id)
          .order('timestamp', { ascending: false })
          .limit(3);
        
        if (!alertsError) {
          setRecentAlerts(alertsData);
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

  const setupSensors = () => {
    // Sensor setup
  };

  const setupSocket = () => {
    socketRef.current = io(API_URL);
    socketRef.current.on('emergency_triggered', (data) => {
      if (data.user_id === user?.id) {
        Alert.alert('Emergency Alert Sent', 'Your emergency contacts have been notified');
        // Refresh alerts
        loadRecentAlerts();
      }
    });
  };

  const loadRecentAlerts = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from('emergency_alerts')
      .select('*')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: false })
      .limit(3);
    
    if (data) {
      setRecentAlerts(data);
    }
  };

  const handleAccelerometerData = (data) => {
    setAccelerometerData(data);
    
    if (!isEmergencyActive && enabledGestures.includes('shake')) {
      // Detect shake gesture
      const acceleration = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
      const now = Date.now();
      
      if (acceleration > 2.5) { // Shake threshold
        if (now - lastShakeTime.current > 500) {
          setShakeCount(prev => {
            const newCount = prev + 1;
            if (newCount >= 5) {
              triggerEmergency('shake');
              return 0;
            }
            return newCount;
          });
          lastShakeTime.current = now;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      } else {
        setTimeout(() => {
          setShakeCount(0);
        }, 2000);
      }
    }
    
    // Detect fall if enabled
    if (enabledGestures.includes('fall_detection')) {
      detectFall(data);
    }
  };

  const detectFall = (data) => {
    const acceleration = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
    
    if (acceleration > 5) {
      setTimeout(() => {
        const stillness = Math.abs(data.x) < 0.5 && Math.abs(data.y) < 0.5 && Math.abs(data.z) < 0.5;
        if (stillness) {
          triggerEmergency('fall_detection');
        }
      }, 3000);
    }
  };

  const handleAppStateChange = (nextAppState) => {
    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
      Vibration.vibrate(100);
    }
    appState.current = nextAppState;
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
      `Emergency will be triggered in ${countdown} seconds. Tap CANCEL to abort.`,
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
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        Alert.alert('Error', 'Not authenticated');
        return;
      }

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
      
      // Send to backend
      const response = await axios.post(
        `${API_URL}/api/emergency/trigger`, 
        alertData,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        }
      );
      
      if (response.data.success) {
        // Also save directly to Supabase as backup
        await supabase
          .from('emergency_alerts')
          .insert([
            {
              user_id: user.id,
              trigger_type: triggerType,
              location_lat: locationData.coords.latitude,
              location_lng: locationData.coords.longitude,
              location_address: address[0] ? `${address[0].street}, ${address[0].city}` : 'Unknown',
              status: 'active'
            }
          ]);
        
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
      console.error('Error sending emergency alert:', error);
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

  // Helper function to get icon name for gesture type
  const getGestureIconName = (gesture) => {
    if (gesture.includes('volume')) return 'volume-up';
    if (gesture.includes('power')) return 'power-settings-new';
    if (gesture.includes('shake')) return 'vibration';
    if (gesture.includes('fall')) return 'personal-injury';
    if (gesture.includes('back')) return 'touch-app';
    if (gesture.includes('tap')) return 'touch-app';
    if (gesture.includes('swipe')) return 'swipe';
    if (gesture.includes('pattern')) return 'gesture';
    return 'gesture'; // default
  };

  // Helper function to get icon name for alert status
  const getAlertStatusIconName = (status) => {
    switch (status) {
      case 'active': return 'pending';
      case 'resolved': return 'check-circle';
      case 'cancelled': return 'cancel';
      default: return 'error';
    }
  };

  // Helper function to get color for alert status
  const getAlertStatusColor = (status) => {
    switch (status) {
      case 'active': return '#f39c12'; // Orange
      case 'resolved': return '#2ecc71'; // Green
      case 'cancelled': return '#e74c3c'; // Red
      default: return '#95a5a6'; // Gray
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
          <Icon name="check-circle" size={16} color="#2ecc71" />
          <Text style={styles.statusText}>
            {enabledGestures.length} gestures active
          </Text>
        </View>
      </View>
      
      {isEmergencyActive && (
        <View style={styles.countdownContainer}>
          <Icon name="warning" size={24} color="white" style={styles.countdownIcon} />
          <Text style={styles.countdownText}>Emergency in: {countdown}s</Text>
          <Text style={styles.countdownSubtext}>Tap CANCEL in alert dialog to abort</Text>
        </View>
      )}
      
      <View style={styles.mainContent}>
        <TouchableOpacity
          style={styles.emergencyButton}
          onPress={handleManualTrigger}
          activeOpacity={0.7}
        >
          <Icon name="warning" size={80} color="white" />
          <Text style={styles.buttonText}>SOS</Text>
          <Text style={styles.buttonSubtext}>Tap for emergency</Text>
        </TouchableOpacity>
        
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Icon name="notifications-active" size={24} color="#e74c3c" />
            <Text style={styles.statNumber}>{recentAlerts.length}</Text>
            <Text style={styles.statLabel}>Total Alerts</Text>
          </View>
          <View style={styles.statCard}>
            <Icon name="touch-app" size={24} color="#e74c3c" />
            <Text style={styles.statNumber}>{enabledGestures.length}</Text>
            <Text style={styles.statLabel}>Active Gestures</Text>
          </View>
          <View style={styles.statCard}>
            <Icon name="pending-actions" size={24} color="#e74c3c" />
            <Text style={styles.statNumber}>
              {recentAlerts.filter(a => a.status === 'active').length}
            </Text>
            <Text style={styles.statLabel}>Active Alerts</Text>
          </View>
        </View>
        
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon name="gesture" size={20} color="#333" />
            <Text style={styles.sectionTitle}>Active Gestures</Text>
          </View>
          <View style={styles.gestureGrid}>
            {enabledGestures.slice(0, 6).map((gesture, index) => (
              <View key={index} style={styles.gestureItem}>
                <Icon 
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
                <Icon name="gesture" size={32} color="#ccc" />
                <Text style={styles.noDataText}>
                  No gestures enabled. Go to Gestures settings to enable them.
                </Text>
              </View>
            )}
          </View>
        </View>
        
        {recentAlerts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="history" size={20} color="#333" />
              <Text style={styles.sectionTitle}>Recent Alerts</Text>
            </View>
            {recentAlerts.map((alert, index) => (
              <View key={index} style={styles.alertItem}>
                <Icon 
                  name={getAlertStatusIconName(alert.status)}
                  size={24} 
                  color={getAlertStatusColor(alert.status)} 
                />
                <View style={styles.alertDetails}>
                  <Text style={styles.alertType}>
                    {alert.trigger_type.replace(/_/g, ' ')}
                  </Text>
                  <View style={styles.alertMeta}>
                    <Icon name="access-time" size={12} color="#999" />
                    <Text style={styles.alertTime}>
                      {formatDate(alert.timestamp)}
                    </Text>
                  </View>
                </View>
                <Icon name="chevron-right" size={20} color="#ccc" />
              </View>
            ))}
          </View>
        )}
      </View>
      
      {location && (
        <View style={styles.locationContainer}>
          <Icon name="location-on" size={20} color="#666" />
          <Text style={styles.locationText} numberOfLines={1}>
            {location.address}
          </Text>
          <Icon name="my-location" size={16} color="#2ecc71" style={styles.locationIcon} />
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
    flexDirection: 'column',
  },
  countdownIcon: {
    marginBottom: 5,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
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
    minWidth: 100,
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
  locationIcon: {
    marginLeft: 5,
  },
});

export default HomeScreen;