import { Accelerometer } from 'expo-sensors';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import axios from 'axios';

// Try to import background modules, but don't fail if they're not available
let TaskManager, BackgroundFetch;
try {
  TaskManager = require('expo-task-manager');
  BackgroundFetch = require('expo-background-fetch');
} catch (error) {
  console.log('Background modules not available:', error.message);
}

const GESTURE_DETECTION_TASK = 'background-gesture-detection';
const SHAKE_DURATION = 5000; // 5 seconds for shake gesture
const POWER_BUTTON_PRESSES = 3; // 3 presses for power button

class GestureService {
  constructor() {
    this.isListening = false;
    this.shakeStartTime = null;
    this.shakeCount = 0;
    this.lastShakeTime = 0;
    this.powerButtonPresses = 0;
    this.lastPowerPressTime = 0;
    this.screenCoverStartTime = null;
    this.fallDetectionTimer = null;
    this.gestureSettings = null;
    this.API_URL = 'http://localhost:5000'; // Change to your computer's IP
    
    // Accelerometer data for fall detection
    this.accelerometerData = { x: 0, y: 0, z: 0 };
    
    // Bind methods
    this.handleAccelerometerData = this.handleAccelerometerData.bind(this);
  }

  async initialize() {
    try {
      // Load user settings
      await this.loadGestureSettings();
      
      // Request permissions
      await this.requestPermissions();
      
      // Start listening
      this.startListening();
      
      console.log('Gesture service initialized');
    } catch (error) {
      console.error('Error initializing gesture service:', error);
    }
  }

  async requestPermissions() {
    try {
      // Request notification permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.log('Failed to get push token for notifications');
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
    }
  }

  async loadGestureSettings() {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const user = await AsyncStorage.getItem('user');
      
      if (!token || !user) return;
      
      const response = await axios.get(`${this.API_URL}/api/gesture-preferences`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.data.success) {
        this.gestureSettings = response.data.preferences.reduce((acc, pref) => {
          acc[pref.gesture_type] = pref;
          return acc;
        }, {});
      }
    } catch (error) {
      console.error('Error loading gesture settings:', error);
    }
  }

  startListening() {
    if (this.isListening) return;
    
    this.isListening = true;
    
    // Set up accelerometer listener
    this.accelerometerSubscription = Accelerometer.addListener(this.handleAccelerometerData);
    
    Accelerometer.setUpdateInterval(100); // 100ms interval
    
    console.log('Gesture listening started');
  }

  stopListening() {
    if (this.accelerometerSubscription) {
      this.accelerometerSubscription.remove();
    }
    
    this.isListening = false;
    console.log('Gesture listening stopped');
  }

  handleAccelerometerData(data) {
    this.accelerometerData = data;
    
    // Check if we have settings
    if (!this.gestureSettings) return;
    
    // Calculate acceleration magnitude
    const acceleration = Math.sqrt(
      data.x * data.x + data.y * data.y + data.z * data.z
    );
    
    const now = Date.now();
    
    // Check for shake gesture (5 seconds continuous shaking)
    if (this.gestureSettings.shake?.enabled) {
      this.detectShake(acceleration, now);
    }
    
    // Check for fall detection
    if (this.gestureSettings.fall_detection?.enabled) {
      this.detectFall(acceleration, now);
    }
  }

  detectShake(acceleration, timestamp) {
    const sensitivity = this.gestureSettings.shake?.sensitivity || 5;
    const threshold = 2.0 + ((sensitivity - 5) * 0.1); // Adjust threshold based on sensitivity
    
    if (acceleration > threshold) {
      if (!this.shakeStartTime) {
        this.shakeStartTime = timestamp;
      } else if (timestamp - this.shakeStartTime >= SHAKE_DURATION) {
        // Shake detected for required duration
        this.triggerEmergency('shake');
        this.shakeStartTime = null;
      }
    } else {
      // Reset if shaking stops
      if (this.shakeStartTime && timestamp - this.shakeStartTime < SHAKE_DURATION) {
        this.shakeStartTime = null;
      }
    }
  }

  detectFall(acceleration, timestamp) {
    const sensitivity = this.gestureSettings.fall_detection?.sensitivity || 5;
    const fallThreshold = 4.0 + ((sensitivity - 5) * 0.2); // Adjust threshold based on sensitivity
    
    // Check for sudden impact
    if (acceleration > fallThreshold) {
      // Possible fall detected, wait for stillness
      if (!this.fallDetectionTimer) {
        this.fallDetectionTimer = setTimeout(() => {
          // Check if device is still (minimal movement)
          const stillness = Math.abs(this.accelerometerData.x) < 0.5 &&
                           Math.abs(this.accelerometerData.y) < 0.5 &&
                           Math.abs(this.accelerometerData.z) < 0.5;
          
          if (stillness) {
            this.triggerEmergency('fall_detection');
          }
          
          this.fallDetectionTimer = null;
        }, 3000);
      }
    }
  }

  // Call this from native modules for power button detection
  handlePowerButtonPress() {
    if (!this.gestureSettings?.power_button_three?.enabled) return;
    
    const now = Date.now();
    const sensitivity = this.gestureSettings.power_button_three?.sensitivity || 5;
    const timeWindow = 1500 - ((sensitivity - 5) * 50); // 1-1.5 second window
    
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

  // Call this from native modules for volume button detection
  handleVolumeButtonsPress() {
    if (!this.gestureSettings?.volume_buttons?.enabled) return;
    this.triggerEmergency('volume_buttons');
  }

  // Call this from native modules for all buttons press
  handleAllButtonsPress() {
    if (!this.gestureSettings?.all_buttons?.enabled) return;
    this.triggerEmergency('all_buttons');
  }

  // Call this from native modules for back tap detection
  handleBackTap() {
    if (!this.gestureSettings?.back_tap?.enabled) return;
    this.triggerEmergency('back_tap');
  }

  // Call this from native modules for screen cover detection
  handleScreenCover() {
    if (!this.gestureSettings?.screen_cover?.enabled) return;
    
    if (!this.screenCoverStartTime) {
      this.screenCoverStartTime = Date.now();
      
      // Check after 3 seconds if still covered
      setTimeout(() => {
        if (this.screenCoverStartTime && Date.now() - this.screenCoverStartTime >= 3000) {
          this.triggerEmergency('screen_cover');
        }
        this.screenCoverStartTime = null;
      }, 3000);
    }
  }

  async triggerEmergency(triggerType) {
    try {
      console.log(`Emergency triggered via: ${triggerType}`);
      
      // Provide haptic feedback
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch (error) {
        console.log('Haptics not available');
      }
      
      // Show local notification
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Emergency Alert Triggered',
            body: `Gesture detected: ${triggerType.replace(/_/g, ' ')}`,
            data: { triggerType },
          },
          trigger: null,
        });
      } catch (error) {
        console.log('Notification error:', error);
      }
      
      // Get current location
      const location = await this.getCurrentLocation();
      
      // Get user token
      const token = await AsyncStorage.getItem('access_token');
      
      if (!token) {
        console.log('No token available');
        return;
      }
      
      // Send to backend
      try {
        const response = await axios.post(
          `${this.API_URL}/api/emergency/trigger`,
          {
            trigger_type: triggerType,
            location: location
          },
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );
        
        if (response.data.success) {
          // Show success notification
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Emergency Alert Sent',
              body: 'Your emergency contacts have been notified',
              data: { success: true },
            },
            trigger: null,
          });
        }
      } catch (error) {
        console.error('Error sending to backend:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error triggering emergency:', error);
      
      // Show error notification
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Emergency Alert Failed',
            body: 'Please try again or call emergency services directly',
            data: { error: true },
          },
          trigger: null,
        });
      } catch (notifError) {
        console.log('Error notification failed:', notifError);
      }
    }
  }

  async getCurrentLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        const address = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        });
        
        return {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          address: address[0] ? 
            `${address[0].street || ''}, ${address[0].city || ''}, ${address[0].country || ''}`.replace(/^, |, $/g, '') 
            : 'Unknown'
        };
      }
    } catch (error) {
      console.error('Error getting location:', error);
    }
    
    return null;
  }

  // Method to be called from main app when user logs in/out
  async updateUserSession() {
    await this.loadGestureSettings();
  }
}

// Create singleton instance
const gestureService = new GestureService();
export default gestureService;