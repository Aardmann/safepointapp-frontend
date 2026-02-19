import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Slider from '@react-native-community/slider';
import { supabase } from '../services/supabase';

const GestureSettingsScreen = () => {
  const [gestures, setGestures] = useState([
    {
      id: 'volume_buttons',
      name: 'Volume Buttons',
      description: 'Press both volume buttons simultaneously',
      icon: 'volume-up',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'power_button_five',
      name: 'Power Button (5x)',
      description: 'Press power button 5 times quickly',
      icon: 'power-settings-new',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'all_buttons',
      name: 'All Buttons',
      description: 'Press all buttons for 3 seconds',
      icon: 'dialpad',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'back_tap',
      name: 'Back Tap',
      description: 'Double tap on back of phone',
      icon: 'touch-app',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'shake',
      name: 'Shake',
      description: 'Shake phone 5 times',
      icon: 'vibration',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'sos_motion',
      name: 'SOS Motion',
      description: 'Draw SOS pattern in air',
      icon: 'gesture',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'screen_cover',
      name: 'Screen Cover',
      description: 'Cover proximity sensor for 3 seconds',
      icon: 'screen-lock-portrait',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'fall_detection',
      name: 'Fall Detection',
      description: 'Detect sudden fall with no movement',
      icon: 'warning',
      enabled: true,
      sensitivity: 5
    },
    {
      id: 'silent_scream',
      name: 'Silent Scream',
      description: 'Cover microphone and scream',
      icon: 'mic-off',
      enabled: true,
      sensitivity: 5
    }
  ]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadUserAndPreferences();
  }, []);

  const loadUserAndPreferences = async () => {
    try {
      setLoading(true);
      
      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (authUser) {
        setUser(authUser);
        
        // Load gesture preferences from Supabase
        const { data: preferences, error } = await supabase
          .from('gesture_preferences')
          .select('*')
          .eq('user_id', authUser.id);
        
        if (error) throw error;
        
        if (preferences && preferences.length > 0) {
          // Update gestures with saved preferences
          setGestures(prevGestures => 
            prevGestures.map(gesture => {
              const savedPref = preferences.find(p => p.gesture_type === gesture.id);
              return savedPref ? {
                ...gesture,
                enabled: savedPref.enabled,
                sensitivity: savedPref.sensitivity
              } : gesture;
            })
          );
        } else {
          // No preferences found, create default ones
          await createDefaultPreferences(authUser.id);
        }
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
      Alert.alert('Error', 'Failed to load gesture settings');
    } finally {
      setLoading(false);
    }
  };

  const createDefaultPreferences = async (userId) => {
    try {
      const defaultGestures = gestures.map(g => ({
        user_id: userId,
        gesture_type: g.id,
        enabled: g.enabled,
        sensitivity: g.sensitivity
      }));

      const { error } = await supabase
        .from('gesture_preferences')
        .insert(defaultGestures);

      if (error) throw error;
    } catch (error) {
      console.error('Error creating default preferences:', error);
    }
  };

  const toggleGesture = async (gestureId) => {
    // Update local state
    const updatedGestures = gestures.map(g => 
      g.id === gestureId ? { ...g, enabled: !g.enabled } : g
    );
    setGestures(updatedGestures);
    
    // Save to Supabase
    try {
      setSaving(true);
      const gesture = updatedGestures.find(g => g.id === gestureId);
      
      const { error } = await supabase
        .from('gesture_preferences')
        .update({ enabled: gesture.enabled })
        .eq('user_id', user.id)
        .eq('gesture_type', gestureId);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating gesture:', error);
      Alert.alert('Error', 'Failed to update gesture setting');
      // Revert on error
      setGestures(prev => prev.map(g => 
        g.id === gestureId ? { ...g, enabled: !g.enabled } : g
      ));
    } finally {
      setSaving(false);
    }
  };

  const updateSensitivity = async (gestureId, value) => {
    // Update local state
    const updatedGestures = gestures.map(g => 
      g.id === gestureId ? { ...g, sensitivity: value } : g
    );
    setGestures(updatedGestures);
    
    // Save to Supabase
    try {
      const { error } = await supabase
        .from('gesture_preferences')
        .update({ sensitivity: value })
        .eq('user_id', user.id)
        .eq('gesture_type', gestureId);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating sensitivity:', error);
    }
  };

  const testGesture = (gestureId) => {
    const gesture = gestures.find(g => g.id === gestureId);
    
    Alert.alert(
      'Test Gesture',
      `Testing: ${gesture.name}\n\nPerform the gesture now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Start Test', 
          onPress: () => {
            // Here you would implement actual gesture testing
            Alert.alert(
              'Listening',
              'Perform the gesture...',
              [
                {
                  text: 'Gesture Performed',
                  onPress: () => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Success', 'Gesture detected!');
                  }
                },
                { text: 'Cancel' }
              ]
            );
          }
        }
      ]
    );
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
              
              // Reset all gestures to default
              const defaultGestures = gestures.map(g => ({
                user_id: user.id,
                gesture_type: g.id,
                enabled: true,
                sensitivity: 5
              }));

              // Delete existing and insert defaults
              await supabase
                .from('gesture_preferences')
                .delete()
                .eq('user_id', user.id);

              await supabase
                .from('gesture_preferences')
                .insert(defaultGestures);

              // Update local state
              setGestures(prev => prev.map(g => ({
                ...g,
                enabled: true,
                sensitivity: 5
              })));

              Alert.alert('Success', 'Settings reset to default');
            } catch (error) {
              console.error('Error resetting settings:', error);
              Alert.alert('Error', 'Failed to reset settings');
            } finally {
              setLoading(false);
            }
          }
        }
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
        {/*<Text style={styles.headerTitle}>Gesture Settings</Text>*/}
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
              <Icon name={gesture.icon} size={24} color="#e74c3c" />
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
                    {gesture.sensitivity === 1 ? 'Low' : 
                    gesture.sensitivity === 10 ? 'High' : 
                    `${gesture.sensitivity}/10`}
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
            onPress={() => testGesture(gesture.id)}
          >
            <Icon name="play-arrow" size={16} color="#666" />
            <Text style={styles.testButtonText}>Test Gesture</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.resetButton} onPress={resetToDefaults}>
        <Icon name="settings-backup-restore" size={20} color="#e74c3c" />
        <Text style={styles.resetButtonText}>Reset to Default Settings</Text>
      </TouchableOpacity>

      <View style={styles.infoContainer}>
        <Icon name="info" size={20} color="#3498db" />
        <Text style={styles.infoText}>
          Test your gestures in a safe environment. Higher sensitivity means easier to trigger.
        </Text>
      </View>
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
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
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
});

export default GestureSettingsScreen;