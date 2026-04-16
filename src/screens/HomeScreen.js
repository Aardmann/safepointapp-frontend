import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  Vibration, Dimensions, ScrollView, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics  from 'expo-haptics';
import AsyncStorage  from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { io } from 'socket.io-client';

import gestureService from '../services/GestureService';
import api, { getApi } from '../services/api';

const { width } = Dimensions.get('window');

// ─── Helper maps ─────────────────────────────────────────────────────────────
const GESTURE_ICONS = {
  shake:              'vibration',
  volume_buttons:     'volume-up',
  power_button_three: 'power-settings-new',
  all_buttons:        'dialpad',
  back_tap:           'touch-app',
  screen_cover:       'screen-lock-portrait',
  fall_detection:     'warning',
  manual:             'sos',
};

const ALERT_STATUS_ICONS  = { active: 'notifications-active', resolved: 'check-circle', default: 'history' };
const ALERT_STATUS_COLORS = { active: '#e74c3c', resolved: '#2ecc71', default: '#f39c12' };

const getGestureIcon  = (g) => GESTURE_ICONS[g] ?? 'touch-app';
const getAlertIcon    = (s) => ALERT_STATUS_ICONS[s]  ?? ALERT_STATUS_ICONS.default;
const getAlertColor   = (s) => ALERT_STATUS_COLORS[s] ?? ALERT_STATUS_COLORS.default;

const formatDate = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const mins  = Math.floor((now - d) / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString();
};

// ─── Component ────────────────────────────────────────────────────────────────
const HomeScreen = ({ navigation }) => {
  const [user,          setUser]          = useState(null);
  const [profile,       setProfile]       = useState(null);
  const [location,      setLocation]      = useState(null);
  const [enabledGestures, setEnabledGestures] = useState([]);
  const [recentAlerts,  setRecentAlerts]  = useState([]);
  const [loading,       setLoading]       = useState(true);

  // Emergency countdown state
  const [isEmergencyActive,  setIsEmergencyActive]  = useState(false);
  const [countdown,          setCountdown]           = useState(0);
  const [pendingTriggerType, setPendingTriggerType]  = useState(null);

  const socketRef      = useRef(null);
  const countdownRef   = useRef(null);
  const emergencyActive = useRef(false); // ref mirror for use inside callbacks

  // ── Countdown ──────────────────────────────────────────────────────────────
  const startCountdown = useCallback((triggerType) => {
    // Guard using a ref so the closure captures a stable value
    if (emergencyActive.current) return;
    emergencyActive.current = true;

    setIsEmergencyActive(true);
    setCountdown(5);
    setPendingTriggerType(triggerType);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Vibration.vibrate([0, 500, 200, 500]);

    let secondsLeft = 5;

    const interval = setInterval(() => {
      secondsLeft -= 1;
      setCountdown(secondsLeft);

      if (secondsLeft <= 0) {
        clearInterval(interval);
        countdownRef.current = null;
        _sendAlert(triggerType);
      }
    }, 1000);

    countdownRef.current = interval;

    const label = triggerType === 'manual'
      ? 'Manual SOS'
      : triggerType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    Alert.alert(
      '🚨 Emergency Alert',
      `Triggered by: ${label}\n\nAlert will be sent in 5 seconds.\nTap CANCEL to abort.`,
      [{
        text: 'CANCEL',
        style: 'cancel',
        onPress: () => {
          if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
          emergencyActive.current = false;
          setIsEmergencyActive(false);
          setCountdown(0);
          setPendingTriggerType(null);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      }],
      { cancelable: false }
    );
  }, []); // no deps — stable reference thanks to the ref guard

  const _sendAlert = async (triggerType) => {
    try {
      const result = await gestureService.sendEmergencyToBackend(triggerType);
      if (result?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Vibration.vibrate([0, 1000, 200, 1000, 200, 1000]);
        Alert.alert(
          'Emergency Alert Sent ✅',
          'Your emergency contacts have been notified with your location.',
          [{ text: 'OK', onPress: loadRecentAlerts }]
        );
      } else {
        Alert.alert('Error', 'Failed to send alert. Please call emergency services directly.');
      }
    } catch (err) {
      console.error('[HomeScreen] sendAlert error:', err);
      Alert.alert('Error', 'Failed to send alert. Please try again.');
    } finally {
      emergencyActive.current = false;
      setIsEmergencyActive(false);
      setCountdown(0);
      setPendingTriggerType(null);
    }
  };

  // ── Register gesture callback ──────────────────────────────────────────────
  useEffect(() => {
    gestureService.setEmergencyCallback(startCountdown);
    return () => {
      // Removing the callback lets the service use the background path
      gestureService.setEmergencyCallback(null);
    };
  }, [startCountdown]);

  // ── Startup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadUserData();
    setupLocation();
    setupSocket();

    return () => {
      if (socketRef.current)   socketRef.current.disconnect();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Data loaders ───────────────────────────────────────────────────────────
  const loadUserData = async () => {
    try {
      setLoading(true);
      const [userData, token] = await Promise.all([
        AsyncStorage.getItem('user'),
        AsyncStorage.getItem('access_token'),
      ]);

      if (!userData || !token) { navigation.replace('Auth'); return; }
      setUser(JSON.parse(userData));

      try {
        const r = await api.get('/api/user/profile');
        if (r.data.success) setProfile(r.data.profile);
      } catch (e) {
        console.error('[HomeScreen] profile load:', e.message);
        const stillHasToken = await AsyncStorage.getItem('access_token');
        if (!stillHasToken) { navigation.replace('Auth'); return; }
      }

      try {
        const r = await api.get('/api/gesture-preferences');
        if (r.data.success) {
          setEnabledGestures(r.data.preferences.filter(g => g.enabled).map(g => g.gesture_type));
        }
      } catch (e) { console.error('[HomeScreen] gestures load:', e.message); }

      await loadRecentAlerts();
    } catch (err) {
      console.error('[HomeScreen] loadUserData:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentAlerts = async () => {
    try {
      const r = await api.get('/api/emergency/alerts?limit=3');
      if (r.data.success) setRecentAlerts(r.data.alerts);
    } catch (e) { console.error('[HomeScreen] alerts load:', e.message); }
  };

  const setupLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const [geo] = await Location.reverseGeocodeAsync({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setLocation({
        lat:     loc.coords.latitude,
        lng:     loc.coords.longitude,
        address: geo ? `${geo.street ?? ''}, ${geo.city ?? ''}`.trim().replace(/^,|,$/, '') : 'Unknown',
      });
    } catch (e) { console.error('[HomeScreen] location setup:', e.message); }
  };

  const setupSocket = async () => {
    try {
      const apiInstance = await getApi();
      const baseURL = apiInstance.defaults.baseURL;
      const token   = await AsyncStorage.getItem('access_token');

      const socket = io(baseURL, { transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect', () => {
        socket.emit('authenticate', { token });
      });

      socket.on('emergency_triggered', () => { loadRecentAlerts(); });
      socket.on('alert_resolved',      () => { loadRecentAlerts(); });
    } catch (e) { console.error('[HomeScreen] socket setup:', e.message); }
  };

  // ── Manual SOS button ─────────────────────────────────────────────────────
  const handleManualTrigger = () => {
    if (isEmergencyActive) return;
    startCountdown('manual');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
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

      {/* Countdown banner */}
      {isEmergencyActive && (
        <View style={styles.countdownBanner}>
          <MaterialIcons name="warning" size={24} color="white" />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.countdownBannerText}>Sending alert in {countdown}s</Text>
            <Text style={styles.countdownBannerSub}>
              {(pendingTriggerType || '').replace(/_/g, ' ')}  •  Tap CANCEL in dialog
            </Text>
          </View>
        </View>
      )}

      <View style={styles.mainContent}>
        {/* SOS button */}
        <TouchableOpacity
          style={[styles.sosButton, isEmergencyActive && styles.sosButtonActive]}
          onPress={handleManualTrigger}
          activeOpacity={0.8}
          disabled={isEmergencyActive}
        >
          {isEmergencyActive ? (
            <>
              <Text style={styles.countdownBig}>{countdown}</Text>
              <Text style={styles.sosSubText}>sending in {countdown}s…</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="warning" size={80} color="white" />
              <Text style={styles.sosText}>SOS</Text>
              <Text style={styles.sosSubText}>Tap for emergency</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <MaterialIcons name="notifications-active" size={24} color="#e74c3c" />
            <Text style={styles.statNum}>{recentAlerts.length}</Text>
            <Text style={styles.statLabel}>Recent Alerts</Text>
          </View>
          <View style={styles.statCard}>
            <MaterialIcons name="touch-app" size={24} color="#e74c3c" />
            <Text style={styles.statNum}>{enabledGestures.length}</Text>
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
            {enabledGestures.length === 0 ? (
              <View style={styles.emptyRow}>
                <MaterialIcons name="gesture" size={32} color="#ccc" />
                <Text style={styles.emptyText}>No gestures enabled — go to Gestures tab</Text>
              </View>
            ) : (
              enabledGestures.slice(0, 6).map((g, i) => (
                <View key={i} style={styles.gestureItem}>
                  <MaterialIcons name={getGestureIcon(g)} size={28} color="#e74c3c" />
                  <Text style={styles.gestureLabel}>{g.replace(/_/g, ' ')}</Text>
                </View>
              ))
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
            {recentAlerts.map((alert, i) => (
              <View key={i} style={styles.alertRow}>
                <MaterialIcons name={getAlertIcon(alert.status)} size={24} color={getAlertColor(alert.status)} />
                <View style={styles.alertDetails}>
                  <Text style={styles.alertType}>{alert.trigger_type.replace(/_/g, ' ')}</Text>
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

      {/* Location footer */}
      {location && (
        <View style={styles.locationBar}>
          <MaterialIcons name="location-on" size={20} color="#666" />
          <Text style={styles.locationText} numberOfLines={1}>{location.address}</Text>
          <MaterialIcons name="my-location" size={16} color="#2ecc71" />
        </View>
      )}
    </ScrollView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer:{ flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    padding: 20, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  welcomeText:  { fontSize: 20, fontWeight: 'bold', color: '#333' },
  gestureStatus:{ flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  statusText:   { marginLeft: 5, fontSize: 14, color: '#666' },

  countdownBanner: {
    backgroundColor: '#c0392b', padding: 15,
    flexDirection: 'row', alignItems: 'center',
  },
  countdownBannerText: { color: 'white', fontSize: 20, fontWeight: 'bold' },
  countdownBannerSub:  { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },

  mainContent: { padding: 20 },

  sosButton: {
    width: width * 0.6, height: width * 0.6,
    borderRadius: width * 0.3, backgroundColor: '#e74c3c',
    justifyContent: 'center', alignItems: 'center',
    alignSelf: 'center', marginBottom: 30, elevation: 6,
    shadowColor: '#e74c3c', shadowOpacity: 0.4, shadowRadius: 12,
  },
  sosButtonActive: { backgroundColor: '#c0392b', opacity: 0.9 },
  sosText:         { color: 'white', fontSize: 32, fontWeight: 'bold', marginTop: 8 },
  sosSubText:      { color: 'white', fontSize: 13, marginTop: 4 },
  countdownBig:    { color: 'white', fontSize: 72, fontWeight: 'bold' },

  statsRow:   { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 25 },
  statCard:   { backgroundColor: '#fff', padding: 15, borderRadius: 12, alignItems: 'center', minWidth: 120, elevation: 2 },
  statNum:    { fontSize: 24, fontWeight: 'bold', color: '#e74c3c', marginTop: 5 },
  statLabel:  { fontSize: 12, color: '#666', marginTop: 4 },

  section:        { marginBottom: 20 },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  sectionTitle:   { fontSize: 17, fontWeight: 'bold', color: '#333', marginLeft: 8 },

  gestureGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff', padding: 15, borderRadius: 12 },
  gestureItem: { width: '33.33%', alignItems: 'center', marginBottom: 15, padding: 5 },
  gestureLabel:{ fontSize: 11, color: '#666', marginTop: 5, textAlign: 'center', textTransform: 'capitalize' },
  emptyRow:    { width: '100%', alignItems: 'center', padding: 20 },
  emptyText:   { color: '#999', textAlign: 'center', marginTop: 8, fontSize: 12 },

  alertRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 8 },
  alertDetails:{ marginLeft: 12, flex: 1 },
  alertType:   { fontSize: 14, fontWeight: '500', color: '#333', textTransform: 'capitalize' },
  alertMeta:   { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  alertTime:   { fontSize: 12, color: '#999', marginLeft: 4 },

  locationBar: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
  locationText:{ marginLeft: 10, fontSize: 14, color: '#666', flex: 1 },
});

export default HomeScreen;