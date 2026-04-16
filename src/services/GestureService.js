import { Accelerometer } from 'expo-sensors';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

// GestureService: Detects configured gestures and triggers emergencies.
// - Listens to accelerometer data for shake and fall detection.
// - Hooks into hardware button events (power, volume, back tap).
// - Manages gesture preferences loaded from the backend.
// - Handles emergency triggering logic with debouncing and notifications.
// - Exposes a callback for HomeScreen to show the 5-second countdown + cancel dialog.
// - Uses the shared API instance for backend communication (benefits from auto token refresh and correct base URL).

// Note: Hardware button event listeners (power, volume, back tap) require native code integration.
// For this example, we assume those events are properly hooked and call the corresponding handler methods.
import api from './api';

const SHAKE_DURATION = 5000;    // 5 seconds of continuous shaking
const POWER_BUTTON_PRESSES = 3; // 3 rapid presses

class GestureService {
  constructor() {
    this.isListening = false;
    this.shakeStartTime = null;
    this.powerButtonPresses = 0;
    this.lastPowerPressTime = 0;
    this.screenCoverStartTime = null;
    this.fallDetectionTimer = null;
    this.gestureSettings = null;

    // Set by HomeScreen to show the 5-second countdown + cancel dialog.
    // Null when the app is in the background → sends directly.
    this.onEmergencyDetected = null;

    // Prevent duplicate triggers within a 10-second window
    this._emergencyPending = false;

    this.accelerometerData = { x: 0, y: 0, z: 0 };
    this.handleAccelerometerData = this.handleAccelerometerData.bind(this);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  setEmergencyCallback(callback) {
    this.onEmergencyDetected = callback;
  }

  async initialize() {
    try {
      await this.loadGestureSettings();
      await this.requestPermissions();
      this.startListening();
      console.log('[GestureService] Initialized');
    } catch (error) {
      console.error('[GestureService] Init error:', error);
    }
  }

  async requestPermissions() {
    try {
      const { status: notifStatus } = await Notifications.getPermissionsAsync();
      if (notifStatus !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }

      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        console.log('[GestureService] Location permission denied');
      }
    } catch (error) {
      console.error('[GestureService] Permission error:', error);
    }
  }

  async loadGestureSettings() {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) return;

      // ✅ Use shared api — benefits from auto token refresh & correct base URL
      const response = await api.get('/api/gesture-preferences');

      if (response.data.success) {
        this.gestureSettings = response.data.preferences.reduce((acc, pref) => {
          acc[pref.gesture_type] = pref;
          return acc;
        }, {});
        console.log('[GestureService] Settings loaded');
      }
    } catch (error) {
      console.error('[GestureService] Failed to load settings:', error.message);
    }
  }

  startListening() {
    if (this.isListening) return;
    this.isListening = true;
    this.accelerometerSubscription = Accelerometer.addListener(this.handleAccelerometerData);
    Accelerometer.setUpdateInterval(100);
    console.log('[GestureService] Listening started');
  }

  stopListening() {
    if (this.accelerometerSubscription) {
      this.accelerometerSubscription.remove();
    }
    this.isListening = false;
    console.log('[GestureService] Listening stopped');
  }

  async updateUserSession() {
    await this.loadGestureSettings();
  }

  // ─── Accelerometer ─────────────────────────────────────────────────────────

  handleAccelerometerData(data) {
    this.accelerometerData = data;
    if (!this.gestureSettings) return;

    const magnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
    const now = Date.now();

    if (this.gestureSettings.shake?.enabled) {
      this.detectShake(magnitude, now);
    }
    if (this.gestureSettings.fall_detection?.enabled) {
      this.detectFall(magnitude, now);
    }
  }

  detectShake(magnitude, timestamp) {
    const sensitivity = this.gestureSettings.shake?.sensitivity || 5;
    const threshold = 2.0 + (sensitivity - 5) * 0.1;

    if (magnitude > threshold) {
      if (!this.shakeStartTime) {
        this.shakeStartTime = timestamp;
      } else if (timestamp - this.shakeStartTime >= SHAKE_DURATION) {
        this.triggerEmergency('shake');
        this.shakeStartTime = null;
      }
    } else {
      if (this.shakeStartTime && timestamp - this.shakeStartTime < SHAKE_DURATION) {
        this.shakeStartTime = null;
      }
    }
  }

  detectFall(magnitude, timestamp) {
    const sensitivity = this.gestureSettings.fall_detection?.sensitivity || 5;
    const fallThreshold = 4.0 + (sensitivity - 5) * 0.2;

    if (magnitude > fallThreshold && !this.fallDetectionTimer) {
      this.fallDetectionTimer = setTimeout(() => {
        const { x, y, z } = this.accelerometerData;
        const isStill = Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(z) < 0.5;
        if (isStill) {
          this.triggerEmergency('fall_detection');
        }
        this.fallDetectionTimer = null;
      }, 3000);
    }
  }

  // ─── Hardware button hooks ─────────────────────────────────────────────────

  handlePowerButtonPress() {
    if (!this.gestureSettings?.power_button_three?.enabled) return;
    const now = Date.now();
    const sensitivity = this.gestureSettings.power_button_three?.sensitivity || 5;
    const timeWindow = 1500 - (sensitivity - 5) * 50;

    if (now - this.lastPowerPressTime < timeWindow) {
      this.powerButtonPresses++;
      if (this.powerButtonPresses >= POWER_BUTTON_PRESSES) {
        this.triggerEmergency('power_button_three');
        this.powerButtonPresses = 0;
      }
    } else {
      this.powerButtonPresses = 1;
    }
    this.lastPowerPressTime = now;
  }

  handleVolumeButtonsPress() {
    if (!this.gestureSettings?.volume_buttons?.enabled) return;
    this.triggerEmergency('volume_buttons');
  }

  handleAllButtonsPress() {
    if (!this.gestureSettings?.all_buttons?.enabled) return;
    this.triggerEmergency('all_buttons');
  }

  handleBackTap() {
    if (!this.gestureSettings?.back_tap?.enabled) return;
    this.triggerEmergency('back_tap');
  }

  handleScreenCover() {
    if (!this.gestureSettings?.screen_cover?.enabled) return;
    if (!this.screenCoverStartTime) {
      this.screenCoverStartTime = Date.now();
      setTimeout(() => {
        if (this.screenCoverStartTime && Date.now() - this.screenCoverStartTime >= 3000) {
          this.triggerEmergency('screen_cover');
        }
        this.screenCoverStartTime = null;
      }, 3000);
    }
  }

  // ─── Core emergency logic ──────────────────────────────────────────────────

  async triggerEmergency(triggerType) {
    if (this._emergencyPending) return;
    this._emergencyPending = true;
    setTimeout(() => { this._emergencyPending = false; }, 10000);

    console.log(`[GestureService] Gesture detected → ${triggerType}`);

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (_) {}

    if (typeof this.onEmergencyDetected === 'function') {
      // Foreground: let HomeScreen show the 5-second countdown + cancel
      this.onEmergencyDetected(triggerType);
    } else {
      // Background: send immediately
      await this._sendDirectly(triggerType);
    }
  }

  async sendEmergencyToBackend(triggerType) {
    try {
      const location = await this.getCurrentLocation();

      // ✅ Use shared api — token is injected by the request interceptor
      const response = await api.post('/api/emergency/trigger', {
        trigger_type: triggerType,
        location,
      });

      if (response.data.success) {
        await this._showNotification(
          'Emergency Alert Sent ✅',
          'Your emergency contacts have been notified.'
        );
      }

      return response.data;
    } catch (error) {
      console.error('[GestureService] Backend send failed:', error.message);
      await this._showNotification(
        'Emergency Alert Failed ❌',
        'Could not reach server. Please call emergency services directly.'
      );
      return { success: false, error: error.message };
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async _sendDirectly(triggerType) {
    await this._showNotification(
      '🚨 Emergency Alert Triggered',
      `Gesture: ${triggerType.replace(/_/g, ' ')} — sending alert to your contacts…`
    );
    await this.sendEmergencyToBackend(triggerType);
  }

  async _showNotification(title, body) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: null,
      });
    } catch (e) {
      console.log('[GestureService] Notification error:', e.message);
    }
  }

  async getCurrentLocation() {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return null;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      return {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        address: geo
          ? [geo.street, geo.city, geo.country].filter(Boolean).join(', ')
          : 'Unknown location',
      };
    } catch (error) {
      console.error('[GestureService] Location error:', error.message);
      return null;
    }
  }
}

const gestureService = new GestureService();
export default gestureService;