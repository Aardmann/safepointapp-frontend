import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { io } from 'socket.io-client';

import gestureService from '../services/GestureService';
import api, { getApi } from '../services/api';

const { width } = Dimensions.get('window');

const HomeScreen = ({ navigation }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [location, setLocation] = useState(null);
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [pendingTriggerType, setPendingTriggerType] = useState(null);
  const [enabledGestures, setEnabledGestures] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const socketRef = useRef(null);
  const countdownRef = useRef(null); // store interval so we can cancel it

  // ─── Countdown + cancel logic ───────────────────────────────────────────────
  //
  // This is shared by both the manual SOS button and any gesture trigger.
  // When a gesture fires, gestureService calls onEmergencyDetected(triggerType)
  // which calls startCountdown() here, giving the user 5 s to cancel.
  //
  const startCountdown = useCallback((triggerType) => {
    if (isEmergencyActive) return; // already counting down, ignore duplicate

    setIsEmergencyActive(true);
    setCountdown(5);
    setPendingTriggerType(triggerType);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.vibrate([0, 500, 200, 500]);

    let secondsLeft = 5;

    // Store the interval ref BEFORE showing the Alert so the cancel
    //    handler can always clear it, even if the Alert appears before
    //    the ref is assigned (race condition guard).
    const interval = setInterval(() => {
      secondsLeft -= 1;
      setCountdown(secondsLeft);

      if (secondsLeft <= 0) {
        clearInterval(interval);
        countdownRef.current = null;
        // Send via the service (keeps backend logic in one place)
        sendEmergencyAlert(triggerType);
      }
    }, 1000);

    countdownRef.current = interval;

    const gestureLabel = triggerType === 'manual'
      ? 'Manual SOS'
      : triggerType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    Alert.alert(
      '🚨 Emergency Alert',
      `Triggered by: ${gestureLabel}\n\nAlert will be sent in 5 seconds.\nTap CANCEL to abort.`,
      [
        {
          text: 'CANCEL',
          style: 'cancel',
          onPress: () => {
            if (countdownRef.current) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
            setIsEmergencyActive(false);
            setCountdown(0);
            setPendingTriggerType(null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
      { cancelable: false }
    );
  }, [isEmergencyActive]);

  // ─── Actual send (called after countdown reaches 0) ──────────────────────
  const sendEmergencyAlert = async (triggerType) => {
    try {
      // Delegate to GestureService which owns all backend / notification logic
      const result = await gestureService.sendEmergencyToBackend(triggerType);

      if (result?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Vibration.vibrate([0, 1000, 200, 1000, 200, 1000]);
        Alert.alert(
          'Emergency Alert Sent ✅',
          'Your emergency contacts have been notified with your location.',
          [{ text: 'OK', onPress: () => loadRecentAlerts() }]
        );
      } else {
        Alert.alert('Error', 'Failed to send emergency alert. Please try again or call emergency services.');
      }
    } catch (error) {
      console.error('HomeScreen: sendEmergencyAlert error', error);
      Alert.alert('Error', 'Failed to send emergency alert. Please try again.');
    } finally {
      setIsEmergencyActive(false);
      setCountdown(0);
      setPendingTriggerType(null);
    }
  };

  // ─── Register gesture callback ────────────────────────────────────────────
  //
  // Every time startCountdown changes (isEmergencyActive changes) we update
  // the callback so the service always calls the latest version.
  //
  useEffect(() => {
    gestureService.setEmergencyCallback(startCountdown);

    return () => {
      // When screen unmounts, remove the callback so background path takes over
      gestureService.setEmergencyCallback(null);
    };
  }, [startCountdown]);

  // ─── Startup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    loadUserData();
    setupLocation();
    setupSocket();

    gestureService.initialize();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      // Clear any running countdown
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ─── Data loaders ─────────────────────────────────────────────────────────
  const loadUserData = async () => {
    try {
      setLoading(true);
      const userData = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('access_token');

      // No stored session — go straight to login
      if (!userData || !token) {
        navigation.replace('Auth');
        return;
      }

      setUser(JSON.parse(userData));

      try {
        const response = await api.get('/api/user/profile');
        if (response.data.success) setProfile(response.data.profile);
      } catch (e) {
        console.error('profile load', e.message);
        // If this was a 401 and refresh also failed, _signOut() will have
        // cleared AsyncStorage and called the auth failure callback which
        // navigates to login. We can check here as a safety net.
        const stillHasToken = await AsyncStorage.getItem('access_token');
        if (!stillHasToken) {
          navigation.replace('Auth');
          return;
        }
      }

      try {
        const gesturesResponse = await api.get('/api/gesture-preferences');
        if (gesturesResponse.data.success) {
          setEnabledGestures(
            gesturesResponse.data.preferences.filter(g => g.enabled).map(g => g.gesture_type)
          );
        }
      } catch (e) { console.error('gestures load', e.message); }

      await loadRecentAlerts();
    } catch (error) {
      console.error('loadUserData', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentAlerts = async () => {
    try {
      const response = await api.get('/api/emergency/alerts?limit=3');
      if (response.data.success) setRecentAlerts(response.data.alerts);
    } catch (e) { console.error('alerts load', e.message); }
  };

  const setupLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        setLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          address: geo ? `${geo.street}, ${geo.city}` : 'Unknown',
        });
      }
    } catch (e) { console.error('location setup', e.message); }
  };

  const setupSocket = async () => {
    // Use the same dynamic URL as the API client — avoids hardcoded simulator
    // addresses breaking on physical devices.
    const axiosInstance = await getApi();
    const socketUrl = axiosInstance.defaults.baseURL;
    socketRef.current = io(socketUrl, { transports: ['websocket'] });

    const authenticate = async () => {
      const token = await AsyncStorage.getItem('access_token');
      if (token) socketRef.current.emit('authenticate', { token });
    };
    authenticate();

    socketRef.current.on('emergency_triggered', (data) => {
      if (data.user_id === user?.id) {
        Alert.alert('Emergency Alert Sent', 'Your emergency contacts have been notified');
        loadRecentAlerts();
      }
    });

    socketRef.current.on('alert_resolved', (data) => {
      if (data.user_id === user?.id) loadRecentAlerts();
    });
  };

  // ─── UI handlers ──────────────────────────────────────────────────────────
  const handleManualTrigger = () => startCountdown('manual');

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const diffMins = Math.floor((Date.now() - date) / 60000);
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
    if (status === 'active') return 'pending';
    if (status === 'resolved') return 'check-circle';
    return 'error';
  };

  const getAlertStatusColor = (status) => {
    if (status === 'active') return '#f39c12';
    if (status === 'resolved') return '#2ecc71';
    return '#95a5a6';
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
            {enabledGestures.length} gesture{enabledGestures.length !== 1 ? 's' : ''} active
          </Text>
        </View>
      </View>

      {/* ✅ Countdown banner — visible whenever an emergency is pending */}
      {isEmergencyActive && (
        <View style={styles.countdownContainer}>
          <MaterialIcons name="warning" size={24} color="white" />
          <Text style={styles.countdownText}>Sending alert in: {countdown}s</Text>
          <Text style={styles.countdownSubtext}>
            Trigger: {(pendingTriggerType || '').replace(/_/g, ' ')}  •  Tap CANCEL in dialog to abort
          </Text>
        </View>
      )}

      <View style={styles.mainContent}>
        <TouchableOpacity
          style={[styles.emergencyButton, isEmergencyActive && styles.emergencyButtonActive]}
          onPress={handleManualTrigger}
          activeOpacity={0.7}
          disabled={isEmergencyActive}
        >
          {isEmergencyActive ? (
            <>
              <Text style={styles.countdownBig}>{countdown}</Text>
              <Text style={styles.buttonSubtext}>sending in {countdown}s…</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="warning" size={80} color="white" />
              <Text style={styles.buttonText}>SOS</Text>
              <Text style={styles.buttonSubtext}>Tap for emergency</Text>
            </>
          )}
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

        {/* Active gestures grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="gesture" size={20} color="#333" />
            <Text style={styles.sectionTitle}>Active Gestures</Text>
          </View>
          <View style={styles.gestureGrid}>
            {enabledGestures.slice(0, 6).map((gesture, index) => (
              <View key={index} style={styles.gestureItem}>
                <MaterialIcons name={getGestureIconName(gesture)} size={28} color="#e74c3c" />
                <Text style={styles.gestureLabel}>{gesture.replace(/_/g, ' ')}</Text>
              </View>
            ))}
            {enabledGestures.length === 0 && (
              <View style={styles.noDataContainer}>
                <MaterialIcons name="gesture" size={32} color="#ccc" />
                <Text style={styles.noDataText}>
                  No gestures enabled. Go to Gestures tab to enable them.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Recent alerts */}
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
                    <Text style={styles.alertTime}>{formatDate(alert.timestamp)}</Text>
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
          <Text style={styles.locationText} numberOfLines={1}>{location.address}</Text>
          <MaterialIcons name="my-location" size={16} color="#2ecc71" />
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  welcomeText: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  gestureStatus: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  statusText: { marginLeft: 5, fontSize: 14, color: '#666' },

  // ✅ Countdown banner
  countdownContainer: {
    backgroundColor: '#c0392b',
    padding: 15,
    alignItems: 'center',
  },
  countdownText: { color: 'white', fontSize: 22, fontWeight: 'bold' },
  countdownSubtext: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4, textTransform: 'capitalize' },

  mainContent: { padding: 20 },

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
  emergencyButtonActive: {
    backgroundColor: '#c0392b',
    opacity: 0.9,
  },
  buttonText: { color: 'white', fontSize: 32, fontWeight: 'bold', marginTop: 10 },
  buttonSubtext: { color: 'white', fontSize: 14, marginTop: 5 },
  countdownBig: { color: 'white', fontSize: 72, fontWeight: 'bold' },

  statsContainer: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 30 },
  statCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 120,
    elevation: 2,
  },
  statNumber: { fontSize: 24, fontWeight: 'bold', color: '#e74c3c', marginTop: 5 },
  statLabel: { fontSize: 12, color: '#666', marginTop: 5 },

  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginLeft: 8 },

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
  noDataContainer: { width: '100%', alignItems: 'center', padding: 20 },
  noDataText: { color: '#999', textAlign: 'center', marginTop: 8, fontSize: 12 },

  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  alertDetails: { marginLeft: 12, flex: 1 },
  alertType: { fontSize: 14, fontWeight: '500', color: '#333', textTransform: 'capitalize' },
  alertMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  alertTime: { fontSize: 12, color: '#999', marginLeft: 4 },

  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  locationText: { marginLeft: 10, fontSize: 14, color: '#666', flex: 1 },
});

export default HomeScreen;