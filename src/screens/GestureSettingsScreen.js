import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import api from '../services/api';
import gestureService from '../services/GestureService';

const GestureSettingsScreen = () => {
  const [gestures, setGestures] = useState([
    {
      id: 'volume_buttons',
      name: 'Volume Buttons',
      description: 'Press both volume buttons simultaneously',
      icon: 'volume-up',
      enabled: true,
      sensitivity: 5,
    },
    {
      id: 'power_button_three',
      name: 'Power Button (3x)',
      description: 'Press power button 3 times quickly',
      icon: 'power-settings-new',
      enabled: true,
      sensitivity: 5,
    },
    {
      id: 'all_buttons',
      name: 'All Buttons',
      description: 'Press all buttons for 3 seconds',
      icon: 'dialpad',
      enabled: true,
      sensitivity: 5,
    },
    {
      id: 'back_tap',
      name: 'Back Tap',
      description: 'Double tap on back of phone',
      icon: 'touch-app',
      enabled: true,
      sensitivity: 5,
    },
    {
      id: 'shake',
      name: 'Shake',
      description: 'Shake phone for 5 seconds',
      icon: 'vibration',
      enabled: true,
      sensitivity: 5,
    },
    {
      id: 'screen_cover',
      name: 'Screen Cover',
      description: 'Cover proximity sensor for 3 seconds',
      icon: 'screen-lock-portrait',
      enabled: true,
      sensitivity: 5,
    },
    {
      id: 'fall_detection',
      name: 'Fall Detection',
      description: 'Detect sudden fall with no movement',
      icon: 'warning',
      enabled: true,
      sensitivity: 5,
    },
  ]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [testingGesture, setTestingGesture] = useState(null);
  const [testResult, setTestResult] = useState(null); // null, 'success', 'failure'
  const [testListening, setTestListening] = useState(false);

  useEffect(() => {
    loadUserAndPreferences();
  }, []);

  const loadUserAndPreferences = async () => {
    try {
      setLoading(true);
      const userData = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('access_token');

      if (userData && token) {
        const response = await api.get('/api/gesture-preferences');

        if (response.data.success) {
          const preferences = response.data.preferences;
          setGestures((prevGestures) =>
            prevGestures.map((gesture) => {
              const savedPref = preferences.find((p) => p.gesture_type === gesture.id);
              return savedPref
                ? {
                    ...gesture,
                    enabled: savedPref.enabled,
                    sensitivity: savedPref.sensitivity,
                  }
                : gesture;
            })
          );
        }
      }
    } catch (error) {
      console.error('Error loading preferences:', error.response?.data || error.message);
      Alert.alert('Error', 'Failed to load gesture settings');
    } finally {
      setLoading(false);
    }
  };

  const toggleGesture = async (gestureId) => {
    const updatedGestures = gestures.map((g) =>
      g.id === gestureId ? { ...g, enabled: !g.enabled } : g
    );
    setGestures(updatedGestures);

    try {
      setSaving(true);
      await api.put('/api/gesture-preferences', {
        preferences: updatedGestures.map((g) => ({
          gesture_type: g.id,
          enabled: g.enabled,
          sensitivity: g.sensitivity,
        })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error updating gesture:', error.response?.data || error.message);
      Alert.alert('Error', 'Failed to update gesture setting');
      setGestures((prev) =>
        prev.map((g) => (g.id === gestureId ? { ...g, enabled: !g.enabled } : g))
      );
    } finally {
      setSaving(false);
    }
  };

  const updateSensitivity = async (gestureId, value) => {
    const updatedGestures = gestures.map((g) =>
      g.id === gestureId ? { ...g, sensitivity: value } : g
    );
    setGestures(updatedGestures);

    try {
      await api.put('/api/gesture-preferences', {
        preferences: updatedGestures.map((g) => ({
          gesture_type: g.id,
          enabled: g.enabled,
          sensitivity: g.sensitivity,
        })),
      });
    } catch (error) {
      console.error('Error updating sensitivity:', error.response?.data || error.message);
    }
  };

  const testGesture = async (gesture) => {
    // Show the listening modal
    setTestingGesture(gesture);
    setTestResult(null);
    setTestListening(true);
    setTestModalVisible(true);

    try {
      const success = await gestureService.startTestForGesture(gesture.id, 10);
      setTestListening(false);
      setTestResult(success);
      Haptics.notificationAsync(
        success
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error
      );
      // Auto-close modal after 2 seconds
      setTimeout(() => {
        setTestModalVisible(false);
        setTestingGesture(null);
        setTestResult(null);
      }, 2000);
    } catch (error) {
      console.error('Test error:', error);
      setTestListening(false);
      setTestResult(false);
      setTimeout(() => {
        setTestModalVisible(false);
      }, 2000);
    }
  };

  const resetToDefaults = async () => {
    Alert.alert(
      'Reset Settings',
      'Are you sure you want to reset all gesture settings to default?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const defaultGestures = gestures.map((g) => ({
                gesture_type: g.id,
                enabled: true,
                sensitivity: 5,
              }));
              await api.put('/api/gesture-preferences', {
                preferences: defaultGestures,
              });
              setGestures((prev) =>
                prev.map((g) => ({
                  ...g,
                  enabled: true,
                  sensitivity: 5,
                }))
              );
              Alert.alert('Success', 'Settings reset to default');
            } catch (error) {
              console.error('Error resetting settings:', error.response?.data || error.message);
              Alert.alert('Error', 'Failed to reset settings');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e74c3c" />
        <Text style={styles.loadingText}>Loading gesture settings...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerSubtitle}>
          Customize how to trigger emergency alerts
        </Text>
      </View>

      {saving && (
        <View style={styles.savingBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.savingText}>Saving changes...</Text>
        </View>
      )}

      {gestures.map((gesture) => (
        <View key={gesture.id} style={styles.gestureCard}>
          <View style={styles.gestureHeader}>
            <View style={styles.gestureIconContainer}>
              <MaterialIcons name={gesture.icon} size={24} color="#e74c3c" />
            </View>
            <View style={styles.gestureInfo}>
              <Text style={styles.gestureName}>{gesture.name}</Text>
              <Text style={styles.gestureDescription}>{gesture.description}</Text>
            </View>
            <Switch
              value={gesture.enabled}
              onValueChange={() => toggleGesture(gesture.id)}
              trackColor={{ false: '#767577', true: '#e74c3c' }}
              thumbColor={gesture.enabled ? '#fff' : '#f4f3f4'}
              disabled={saving}
            />
          </View>

          {gesture.enabled && (
            <View style={styles.sensitivityContainer}>
              <View style={styles.sensitivityHeader}>
                <Text style={styles.sensitivityLabel}>Sensitivity</Text>
                <Text style={styles.sensitivityValue}>
                  {gesture.sensitivity === 1
                    ? 'Low'
                    : gesture.sensitivity === 10
                    ? 'High'
                    : `${gesture.sensitivity}/10`}
                </Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={10}
                step={1}
                value={gesture.sensitivity}
                onValueChange={(value) => updateSensitivity(gesture.id, value)}
                minimumTrackTintColor="#e74c3c"
                maximumTrackTintColor="#ddd"
                thumbTintColor="#e74c3c"
                disabled={saving}
              />
            </View>
          )}

          <TouchableOpacity
            style={styles.testButton}
            onPress={() => testGesture(gesture)}
          >
            <MaterialIcons name="play-arrow" size={16} color="#666" />
            <Text style={styles.testButtonText}>Test Gesture</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.resetButton} onPress={resetToDefaults}>
        <MaterialIcons name="settings-backup-restore" size={20} color="#e74c3c" />
        <Text style={styles.resetButtonText}>Reset to Default Settings</Text>
      </TouchableOpacity>

      <View style={styles.infoContainer}>
        <MaterialIcons name="info" size={20} color="#3498db" />
        <Text style={styles.infoText}>
          Test your gestures in a safe environment. Higher sensitivity means easier to trigger.
        </Text>
      </View>

      {/* Test Gesture Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={testModalVisible}
        onRequestClose={() => setTestModalVisible(false)}
      >
        <View style={styles.testModalOverlay}>
          <View style={styles.testModalContent}>
            {testListening ? (
              <>
                <MaterialIcons name="mic-none" size={60} color="#e74c3c" />
                <Text style={styles.testModalTitle}>
                  Perform {testingGesture?.name}
                </Text>
                <Text style={styles.testModalSubtitle}>
                  {testingGesture?.description}
                </Text>
                <View style={styles.listeningAnimation}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.listeningText}>Listening...</Text>
                </View>
                <Text style={styles.testModalHint}>
                  You have 10 seconds to perform the gesture
                </Text>
              </>
            ) : testResult === true ? (
              <>
                <MaterialIcons name="check-circle" size={60} color="#2ecc71" />
                <Text style={[styles.testModalTitle, { color: '#2ecc71' }]}>Success!</Text>
                <Text style={styles.testModalSubtitle}>
                  {testingGesture?.name} was detected correctly
                </Text>
              </>
            ) : testResult === false ? (
              <>
                <MaterialIcons name="error" size={60} color="#e74c3c" />
                <Text style={[styles.testModalTitle, { color: '#e74c3c' }]}>Failed</Text>
                <Text style={styles.testModalSubtitle}>
                  {testingGesture?.name} was not detected. Try again.
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
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
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  savingBanner: {
    backgroundColor: '#e74c3c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  savingText: {
    color: '#fff',
    marginLeft: 10,
  },
  gestureCard: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginTop: 15,
    borderRadius: 10,
    padding: 15,
    elevation: 2,
  },
  gestureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gestureIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fce4e4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  gestureInfo: {
    flex: 1,
  },
  gestureName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  gestureDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  sensitivityContainer: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  sensitivityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sensitivityLabel: {
    fontSize: 14,
    color: '#333',
  },
  sensitivityValue: {
    fontSize: 14,
    color: '#e74c3c',
    fontWeight: '500',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  testButton: {
    marginTop: 15,
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  testButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 5,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    margin: 15,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  resetButtonText: {
    color: '#e74c3c',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 10,
  },
  infoContainer: {
    flexDirection: 'row',
    backgroundColor: '#e8f4fd',
    margin: 15,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 12,
    color: '#2c3e50',
    lineHeight: 18,
  },
  testModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  testModalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    width: '80%',
  },
  testModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  testModalSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  listeningAnimation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e74c3c',
    marginRight: 10,
  },
  listeningText: {
    fontSize: 16,
    color: '#e74c3c',
    fontWeight: '500',
  },
  testModalHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 10,
  },
});

export default GestureSettingsScreen;