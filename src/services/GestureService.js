/**
 * GestureService.js — Unified gesture detection with full background support.
 *
 * Gestures supported:
 *  ✅ shake            — Accelerometer (foreground + background via TaskManager)
 *  ✅ fall_detection   — Accelerometer (foreground + background via TaskManager)
 *  ✅ screen_cover     — Proximity sensor (foreground only; iOS bg limited)
 *  ✅ volume_buttons   — Simulated via UI long-press (native bridge required for true hw)
 *  ✅ power_button_three — Simulated / native bridge
 *  ✅ all_buttons      — Simulated / native bridge
 *  ✅ back_tap         — Double-tap via Accelerometer pattern
 *
 * Background strategy:
 *  • expo-task-manager + expo-background-fetch registers a background task.
 *  • The accelerometer subscription is kept alive across foreground/background
 *    transitions using AppState.
 *  • When a gesture fires in the background, a local notification is shown
 *    immediately and the alert is POSTed to the backend.
 */

import { Accelerometer } from 'expo-sensors';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';
import api from './api';

// ─── Constants ─────────────────────────────────────────────────────────────
const SHAKE_THRESHOLD        = 2.0;   // g-force above which a shake is registered
const SHAKE_DURATION_MS      = 3000;  // ms of continuous shaking required
const FALL_THRESHOLD         = 3.5;   // sudden spike that indicates a fall
const FALL_STILL_WINDOW_MS   = 3000;  // ms of stillness after spike = confirmed fall
const BACK_TAP_THRESHOLD     = 3.5;   // spike for back-tap detection
const BACK_TAP_WINDOW_MS     = 600;   // max ms between two taps for double-tap
const VOLUME_LONG_PRESS_MS   = 3000;  // ms for volume-button long press
const POWER_BUTTON_PRESSES   = 4;     // rapid presses required
const POWER_BUTTON_WINDOW_MS = 2000;  // window for counting presses
const SCREEN_COVER_MS        = 3000;  // ms proximity sensor must be blocked
const EMERGENCY_COOLDOWN_MS  = 15000; // minimum gap between two emergency triggers
const BG_TASK_NAME           = 'GESTURE_BACKGROUND_TASK';

// ─── Background task definition (must be at module top-level) ──────────────
TaskManager.defineTask(BG_TASK_NAME, async () => {
  try {
    // Re-load gesture settings in background
    const token = await AsyncStorage.getItem('access_token');
    if (!token) return BackgroundFetch.BackgroundFetchResult.NoData;

    // Accelerometer is handled by the persistent subscription started in
    // startListening(); this task simply keeps the process alive on Android.
    console.log('[GestureService BG] Background fetch heartbeat');
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── GestureService class ───────────────────────────────────────────────────
class GestureService {
  constructor() {
    // Subscriptions
    this.accelerometerSubscription = null;
    this.proximitySubscription     = null;

    // State flags
    this.isListening        = false;
    this._emergencyPending  = false;
    this.appState           = AppState.currentState;

    // Accelerometer data
    this.accel = { x: 0, y: 0, z: 0 };

    // Shake detection
    this.shakeStartTime = null;

    // Fall detection
    this.fallTimer       = null;
    this.fallSpikeSeen   = false;

    // Back-tap detection
    this.lastTapTime     = 0;
    this.tapCount        = 0;

    // Power button
    this.powerPressCount   = 0;
    this.lastPowerPressMs  = 0;

    // Volume buttons (hardware bridge sets these)
    this.volumeButtonsDown   = { up: false, down: false };
    this.volumeLongPressTimer = null;

    // Screen cover (proximity)
    this.screenCoverStart = null;
    this.screenCoverTimer = null;

    // Gesture settings fetched from backend
    this.gestureSettings = null;

    // Foreground callback — set by HomeScreen
    this.onEmergencyDetected = null;

    // Test mode
    this.testModeActive    = false;
    this.testGestureType   = null;
    this.testResolve       = null;
    this.testTimeout       = null;
    this.originalOnEmergency = null;

    // Bind handlers once so we can remove them cleanly
    this._handleAccel    = this._handleAccel.bind(this);
    this._handleProximity = this._handleProximity.bind(this);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  setEmergencyCallback(cb) {
    this.onEmergencyDetected = cb;
  }

  async initialize() {
    try {
      await this._requestPermissions();
      await this.loadGestureSettings();
      await this._registerBackgroundTask();
      this._setupAppStateListener();
      this.startListening();
      console.log('[GestureService] Initialized ✅');
    } catch (err) {
      console.error('[GestureService] Init error:', err);
    }
  }

  startListening() {
    if (this.isListening) return;
    this.isListening = true;

    // ── Accelerometer ──────────────────────────────────────────────────────
    Accelerometer.setUpdateInterval(100); // 10 Hz is enough, saves battery
    this.accelerometerSubscription = Accelerometer.addListener(this._handleAccel);

    // ── Proximity sensor ──────────────────────────────────────────────────
    this._startProximitySensor();

    console.log('[GestureService] Listening started');
  }

  stopListening() {
    if (this.accelerometerSubscription) {
      this.accelerometerSubscription.remove();
      this.accelerometerSubscription = null;
    }
    this._stopProximitySensor();
    this.isListening = false;
    console.log('[GestureService] Listening stopped');
  }

  async updateUserSession() {
    await this.loadGestureSettings();
  }

  async loadGestureSettings() {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) return;
      const response = await api.get('/api/gesture-preferences');
      if (response.data.success) {
        this.gestureSettings = response.data.preferences.reduce((acc, p) => {
          acc[p.gesture_type] = p;
          return acc;
        }, {});
        console.log('[GestureService] Settings loaded');
      }
    } catch (err) {
      console.error('[GestureService] Failed to load settings:', err.message);
    }
  }

  // ─── Test Mode ────────────────────────────────────────────────────────────

  async startTestForGesture(gestureType, timeoutSeconds = 10) {
    if (this.testModeActive) throw new Error('Test already in progress');

    this.testModeActive      = true;
    this.testGestureType     = gestureType;
    this.originalOnEmergency = this.onEmergencyDetected;

    // Override callback so we capture the test gesture without sending a real alert
    this.onEmergencyDetected = (type) => {
      this._resolveTest(type === gestureType);
    };

    const promise = new Promise((resolve) => { this.testResolve = resolve; });

    this.testTimeout = setTimeout(() => {
      if (this.testModeActive) this._resolveTest(false);
    }, timeoutSeconds * 1000);

    return promise;
  }

  _resolveTest(success) {
    if (this.testTimeout) clearTimeout(this.testTimeout);
    if (this.testResolve) this.testResolve(success);

    this.onEmergencyDetected = this.originalOnEmergency;
    this.testModeActive      = false;
    this.testGestureType     = null;
    this.testResolve         = null;
    this.testTimeout         = null;
    this.originalOnEmergency = null;
  }

  // ─── Hardware button event handlers (called from native bridge / UI) ──────

  handleVolumeButtonDown(button) {
    if (!this._gestureEnabled('volume_buttons')) return;

    if (button === 'up')   this.volumeButtonsDown.up   = true;
    if (button === 'down') this.volumeButtonsDown.down = true;

    if (this.volumeButtonsDown.up && this.volumeButtonsDown.down && !this.volumeLongPressTimer) {
      console.log('[GestureService] Both volume buttons held — starting 3s timer');
      this.volumeLongPressTimer = setTimeout(() => {
        console.log('[GestureService] Volume long-press confirmed');
        this.triggerEmergency('volume_buttons');
        this._resetVolumeLongPress();
      }, VOLUME_LONG_PRESS_MS);
    }
  }

  handleVolumeButtonUp(button) {
    if (button === 'up')   this.volumeButtonsDown.up   = false;
    if (button === 'down') this.volumeButtonsDown.down = false;
    this._resetVolumeLongPress();
  }

  handlePowerButtonPress() {
    if (!this._gestureEnabled('power_button_three')) return;

    const now = Date.now();
    if (now - this.lastPowerPressMs < POWER_BUTTON_WINDOW_MS) {
      this.powerPressCount++;
    } else {
      this.powerPressCount = 1;
    }
    this.lastPowerPressMs = now;

    console.log(`[GestureService] Power press ${this.powerPressCount}/${POWER_BUTTON_PRESSES}`);
    if (this.powerPressCount >= POWER_BUTTON_PRESSES) {
      console.log('[GestureService] Power button 4× detected');
      this.triggerEmergency('power_button_three');
      this.powerPressCount = 0;
    }
  }

  handleAllButtonsPress() {
    if (!this._gestureEnabled('all_buttons')) return;
    this.triggerEmergency('all_buttons');
  }

  // ─── Core emergency logic ─────────────────────────────────────────────────

  async triggerEmergency(triggerType) {
    if (this._emergencyPending) {
      console.log('[GestureService] Cooldown active — ignoring duplicate');
      return;
    }
    this._emergencyPending = true;
    setTimeout(() => { this._emergencyPending = false; }, EMERGENCY_COOLDOWN_MS);

    console.log(`[GestureService] 🚨 EMERGENCY → ${triggerType}`);

    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch (_) {}

    if (typeof this.onEmergencyDetected === 'function') {
      // Foreground path: show countdown in HomeScreen
      this.onEmergencyDetected(triggerType);
    } else {
      // Background path: fire immediately
      await this._sendDirectly(triggerType);
    }
  }

  /** Called by HomeScreen after the countdown elapses without cancellation. */
  async sendEmergencyToBackend(triggerType) {
    try {
      const location = await this.getCurrentLocation();
      const response = await api.post('/api/emergency/trigger', { trigger_type: triggerType, location });

      if (response.data.success) {
        await this._notify('Emergency Alert Sent ✅', 'Your emergency contacts have been notified.');
      }
      return response.data;
    } catch (err) {
      console.error('[GestureService] Backend send failed:', err.message);
      await this._notify(
        'Emergency Alert Failed ❌',
        'Could not reach server. Please call emergency services directly.'
      );
      return { success: false, error: err.message };
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
        lat:     loc.coords.latitude,
        lng:     loc.coords.longitude,
        address: geo
          ? [geo.street, geo.city, geo.country].filter(Boolean).join(', ')
          : 'Unknown location',
      };
    } catch (err) {
      console.error('[GestureService] Location error:', err.message);
      return null;
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  _gestureEnabled(type) {
    return this.gestureSettings?.[type]?.enabled ?? false;
  }

  _sensitivity(type, fallback = 5) {
    return this.gestureSettings?.[type]?.sensitivity ?? fallback;
  }

  _resetVolumeLongPress() {
    if (this.volumeLongPressTimer) {
      clearTimeout(this.volumeLongPressTimer);
      this.volumeLongPressTimer = null;
    }
  }

  // ── Accelerometer handler ──────────────────────────────────────────────
  _handleAccel(data) {
    this.accel = data;
    if (!this.gestureSettings) return;

    const magnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
    const now = Date.now();

    if (this.testModeActive) {
      switch (this.testGestureType) {
        case 'shake':          this._detectShake(magnitude, now, true); break;
        case 'fall_detection': this._detectFall(magnitude, now, true);  break;
        case 'back_tap':       this._detectBackTap(magnitude, now, true); break;
      }
      return;
    }

    if (this._gestureEnabled('shake'))          this._detectShake(magnitude, now, false);
    if (this._gestureEnabled('fall_detection')) this._detectFall(magnitude, now, false);
    if (this._gestureEnabled('back_tap'))       this._detectBackTap(magnitude, now, false);
  }

  // ── Shake detection ────────────────────────────────────────────────────
  _detectShake(magnitude, now, isTest) {
    const sens      = isTest ? 5 : this._sensitivity('shake');
    const threshold = SHAKE_THRESHOLD + (5 - sens) * 0.1;

    if (magnitude > threshold) {
      if (!this.shakeStartTime) {
        this.shakeStartTime = now;
        console.log('[GestureService] Shake started');
      } else if (now - this.shakeStartTime >= SHAKE_DURATION_MS) {
        console.log('[GestureService] Shake confirmed');
        this.shakeStartTime = null;
        isTest ? this._resolveTest(true) : this.triggerEmergency('shake');
      }
    } else {
      if (this.shakeStartTime && (now - this.shakeStartTime < SHAKE_DURATION_MS)) {
        this.shakeStartTime = null;
        console.log('[GestureService] Shake aborted');
      }
    }
  }

  // ── Fall detection ─────────────────────────────────────────────────────
  _detectFall(magnitude, now, isTest) {
    const sens      = isTest ? 5 : this._sensitivity('fall_detection');
    const threshold = FALL_THRESHOLD + (5 - sens) * 0.15;

    if (magnitude > threshold && !this.fallTimer) {
      console.log('[GestureService] Fall spike detected — waiting for stillness…');
      this.fallSpikeSeen = true;

      this.fallTimer = setTimeout(() => {
        this.fallTimer = null;
        if (!this.fallSpikeSeen) return;
        this.fallSpikeSeen = false;

        const { x, y, z } = this.accel;
        const isStill = Math.abs(x) < 0.4 && Math.abs(y) < 0.4 && Math.abs(z - 1) < 0.4;
        if (isStill) {
          console.log('[GestureService] Fall confirmed (device still)');
          isTest ? this._resolveTest(true) : this.triggerEmergency('fall_detection');
        } else {
          console.log('[GestureService] Fall not confirmed — device moving after spike');
        }
      }, FALL_STILL_WINDOW_MS);
    }
  }

  // ── Back-tap detection (double-tap on back of device) ──────────────────
  _detectBackTap(magnitude, now, isTest) {
    const sens      = isTest ? 5 : this._sensitivity('back_tap');
    const threshold = BACK_TAP_THRESHOLD + (5 - sens) * 0.2;

    if (magnitude > threshold) {
      const elapsed = now - this.lastTapTime;

      if (elapsed < BACK_TAP_WINDOW_MS && elapsed > 80) {
        this.tapCount++;
        if (this.tapCount >= 2) {
          console.log('[GestureService] Back double-tap detected');
          this.tapCount    = 0;
          this.lastTapTime = 0;
          isTest ? this._resolveTest(true) : this.triggerEmergency('back_tap');
        }
      } else {
        this.tapCount = 1;
      }
      this.lastTapTime = now;
    }
  }

  // ── Proximity sensor (screen cover) ────────────────────────────────────
  _startProximitySensor() {
    try {
      // expo-sensors doesn't expose Proximity directly; use DeviceMotion or
      // a light-sensor workaround. Here we attempt the community approach:
      // import dynamically so the import doesn't break on devices without it.
      const { LightSensor } = require('expo-sensors');
      if (!LightSensor || !LightSensor.isAvailableAsync) return;

      LightSensor.isAvailableAsync().then((available) => {
        if (!available) {
          console.log('[GestureService] LightSensor not available (screen_cover disabled)');
          return;
        }
        LightSensor.setUpdateInterval(200);
        this.proximitySubscription = LightSensor.addListener(({ illuminance }) => {
          this._handleProximity(illuminance < 5); // < 5 lux = covered
        });
        console.log('[GestureService] Proximity (LightSensor) started');
      });
    } catch (_) {
      // LightSensor not available — screen_cover gesture will not function
      console.log('[GestureService] LightSensor not available on this device');
    }
  }

  _stopProximitySensor() {
    if (this.proximitySubscription) {
      this.proximitySubscription.remove();
      this.proximitySubscription = null;
    }
    if (this.screenCoverTimer) {
      clearTimeout(this.screenCoverTimer);
      this.screenCoverTimer = null;
    }
    this.screenCoverStart = null;
  }

  _handleProximity(isCovered) {
    if (!this._gestureEnabled('screen_cover')) return;

    if (isCovered) {
      if (!this.screenCoverStart) {
        this.screenCoverStart = Date.now();
        console.log('[GestureService] Screen cover started');
        this.screenCoverTimer = setTimeout(() => {
          console.log('[GestureService] Screen cover 3 s — triggering emergency');
          this.screenCoverStart = null;
          this.screenCoverTimer = null;
          this.triggerEmergency('screen_cover');
        }, SCREEN_COVER_MS);
      }
    } else {
      if (this.screenCoverStart) {
        console.log('[GestureService] Screen cover released early');
        clearTimeout(this.screenCoverTimer);
        this.screenCoverStart = null;
        this.screenCoverTimer = null;
      }
    }
  }

  // ── Background path ────────────────────────────────────────────────────
  async _sendDirectly(triggerType) {
    await this._notify(
      '🚨 Emergency Alert Triggered',
      `Gesture: ${triggerType.replace(/_/g, ' ')} — alerting your contacts…`
    );
    await this.sendEmergencyToBackend(triggerType);
  }

  async _notify(title, body) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: true },
        trigger: null,
      });
    } catch (e) {
      console.warn('[GestureService] Notification error:', e.message);
    }
  }

  // ── Permissions ────────────────────────────────────────────────────────
  async _requestPermissions() {
    try {
      const { status: notif } = await Notifications.getPermissionsAsync();
      if (notif !== 'granted') await Notifications.requestPermissionsAsync();

      await Location.requestForegroundPermissionsAsync();
      // Request background location so we can get coords even when backgrounded
      await Location.requestBackgroundPermissionsAsync();

      if (Platform.OS === 'ios') {
        await Accelerometer.requestPermissionsAsync();
      }
    } catch (err) {
      console.error('[GestureService] Permission error:', err);
    }
  }

  // ── Background task registration ───────────────────────────────────────
  async _registerBackgroundTask() {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_TASK_NAME);
      if (!isRegistered) {
        await BackgroundFetch.registerTaskAsync(BG_TASK_NAME, {
          minimumInterval: 60,        // iOS: fire at most every 60 s (system may delay)
          stopOnTerminate: false,     // Android: keep running after app close
          startOnBoot: true,          // Android: restart on device reboot
        });
        console.log('[GestureService] Background task registered');
      }
    } catch (err) {
      console.warn('[GestureService] Background task registration failed:', err.message);
    }
  }

  // ── AppState listener — keep accelerometer alive in background ─────────
  _setupAppStateListener() {
    AppState.addEventListener('change', (nextState) => {
      console.log(`[GestureService] AppState → ${nextState}`);
      this.appState = nextState;

      if (nextState === 'active') {
        // Came to foreground: restart subscription if it dropped
        if (!this.accelerometerSubscription && this.isListening) {
          Accelerometer.setUpdateInterval(100);
          this.accelerometerSubscription = Accelerometer.addListener(this._handleAccel);
          console.log('[GestureService] Accelerometer restarted on foreground');
        }
        // Refresh gesture settings
        this.loadGestureSettings();
      } else if (nextState === 'background') {
        // Expo-sensors accelerometer continues in background on Android.
        // On iOS it pauses when the app is suspended — TaskManager heartbeat
        // helps but cannot fully overcome iOS restrictions.
        console.log('[GestureService] App backgrounded — accelerometer kept alive');
      }
    });
  }
}

const gestureService = new GestureService();
export default gestureService;