import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';
import { decode } from 'base64-arraybuffer';

const ProfileScreen = ({ navigation }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    fullName: '',
    email: '',
    phone: '',
    avatarUrl: null
  });
  const [stats, setStats] = useState({
    totalAlerts: 0,
    activeAlerts: 0,
    totalContacts: 0,
    enabledGestures: 0
  });

  const API_URL = 'http://localhost:5000';

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      
      // Get current user from Supabase Auth
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      if (authError) throw authError;
      
      if (authUser) {
        setUser(authUser);
        
        // Get profile from Supabase
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .single();

        if (profileError && profileError.code !== 'PGRST116') {
          throw profileError;
        }

        if (profileData) {
          setProfile(profileData);
          setFormData({
            username: profileData.username || '',
            fullName: profileData.full_name || '',
            email: authUser.email || '',
            phone: profileData.phone || '',
            avatarUrl: profileData.avatar_url || null
          });
        } else {
          // Profile doesn't exist, create it
          await createProfile(authUser);
        }

        // Load user stats
        await loadUserStats(authUser.id);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      Alert.alert('Error', 'Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const createProfile = async (authUser) => {
    try {
      const newProfile = {
        id: authUser.id,
        username: authUser.user_metadata?.username || authUser.email?.split('@')[0],
        full_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0],
        phone: authUser.user_metadata?.phone || '',
        avatar_url: null
      };

      const { error } = await supabase
        .from('profiles')
        .insert([newProfile]);

      if (error) throw error;

      setProfile(newProfile);
      setFormData({
        username: newProfile.username,
        fullName: newProfile.full_name,
        email: authUser.email,
        phone: newProfile.phone,
        avatarUrl: null
      });

    } catch (error) {
      console.error('Error creating profile:', error);
    }
  };

  const loadUserStats = async (userId) => {
    try {
      // Get alerts count
      const { data: alerts, error: alertsError } = await supabase
        .from('emergency_alerts')
        .select('status')
        .eq('user_id', userId);

      if (alertsError) throw alertsError;

      // Get contacts count
      const { count: contactsCount, error: contactsError } = await supabase
        .from('emergency_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (contactsError) throw contactsError;

      // Get enabled gestures count
      const { data: gestures, error: gesturesError } = await supabase
        .from('gesture_preferences')
        .select('enabled')
        .eq('user_id', userId)
        .eq('enabled', true);

      if (gesturesError) throw gesturesError;

      setStats({
        totalAlerts: alerts?.length || 0,
        activeAlerts: alerts?.filter(a => a.status === 'active').length || 0,
        totalContacts: contactsCount || 0,
        enabledGestures: gestures?.length || 0
      });

    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant camera roll permissions to upload a profile picture');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true
      });

      if (!result.canceled && result.assets[0].base64) {
        await uploadAvatar(result.assets[0].base64);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const uploadAvatar = async (base64Image) => {
    try {
      setUploading(true);
      
      const fileName = `${user.id}-${Date.now()}.jpg`;
      const filePath = `avatars/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, decode(base64Image), {
          contentType: 'image/jpeg',
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Update profile with avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setFormData(prev => ({ ...prev, avatarUrl: publicUrl }));
      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Profile picture updated');

    } catch (error) {
      console.error('Error uploading avatar:', error);
      Alert.alert('Error', 'Failed to upload profile picture');
    } finally {
      setUploading(false);
    }
  };

  const validateForm = () => {
    if (!formData.username.trim()) {
      Alert.alert('Error', 'Username is required');
      return false;
    }
    if (!formData.email.trim()) {
      Alert.alert('Error', 'Email is required');
      return false;
    }
    if (formData.email && !formData.email.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email');
      return false;
    }
    if (formData.phone && formData.phone.length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return false;
    }
    return true;
  };

  const handleUpdateProfile = async () => {
    if (!validateForm()) return;

    try {
      setSaving(true);

      // Update profile in Supabase
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          username: formData.username.trim(),
          full_name: formData.fullName.trim() || formData.username.trim(),
          phone: formData.phone.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // Update email in auth if changed
      if (formData.email !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: formData.email.trim()
        });

        if (emailError) throw emailError;
      }

      // Update local state
      const updatedProfile = {
        ...profile,
        username: formData.username.trim(),
        full_name: formData.fullName.trim() || formData.username.trim(),
        phone: formData.phone.trim()
      };

      setProfile(updatedProfile);
      
      // Update AsyncStorage
      await AsyncStorage.setItem('user', JSON.stringify({
        id: user.id,
        email: formData.email,
        username: updatedProfile.username,
        fullName: updatedProfile.full_name,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatar_url
      }));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      setIsEditing(false);
      Alert.alert('Success', 'Profile updated successfully');

    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          onPress: async () => {
            try {
              await supabase.auth.signOut();
              await AsyncStorage.removeItem('user');
              await AsyncStorage.removeItem('supabase-session');
              navigation.replace('Auth');
            } catch (error) {
              console.error('Error logging out:', error);
              Alert.alert('Error', 'Failed to logout');
            }
          }
        }
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This action cannot be undone. All your data will be permanently deleted.\n\n' +
      'This includes:\n' +
      `• ${stats.totalContacts} emergency contacts\n` +
      `• ${stats.totalAlerts} alert history\n` +
      `• ${stats.enabledGestures} gesture settings`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);

              // Delete user data from Supabase
              // Note: This will cascade delete due to foreign key constraints
              const { error } = await supabase
                .from('profiles')
                .delete()
                .eq('id', user.id);

              if (error) throw error;

              // Delete auth user (requires admin API or backend)
              // For now, we'll just sign out
              await supabase.auth.signOut();
              await AsyncStorage.removeItem('user');
              await AsyncStorage.removeItem('supabase-session');
              
              navigation.replace('Auth');
              
            } catch (error) {
              console.error('Error deleting account:', error);
              Alert.alert('Error', 'Failed to delete account');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleResetPassword = async () => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: 'yourapp://reset-password',
      });

      if (error) throw error;

      Alert.alert(
        'Password Reset',
        'Check your email for password reset instructions',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error resetting password:', error);
      Alert.alert('Error', 'Failed to send reset email');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#e74c3c" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Profile Header with Avatar */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.avatarContainer}
          onPress={pickImage}
          disabled={uploading}
        >
          {formData.avatarUrl ? (
            <Image 
              source={{ uri: formData.avatarUrl }} 
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>
                {formData.username ? formData.username.charAt(0).toUpperCase() : 'U'}
              </Text>
            </View>
          )}
          {uploading ? (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator color="white" />
            </View>
          ) : (
            <View style={styles.editAvatarBadge}>
              <Icon name="camera-alt" size={16} color="white" />
            </View>
          )}
        </TouchableOpacity>
        
        <Text style={styles.userName}>
          {formData.fullName || formData.username || 'User'}
        </Text>
        <Text style={styles.userEmail}>{formData.email}</Text>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalAlerts}</Text>
          <Text style={styles.statLabel}>Total Alerts</Text>
        </View>
        <View style={[styles.statCard, styles.activeStatCard]}>
          <Text style={styles.statNumber}>{stats.activeAlerts}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalContacts}</Text>
          <Text style={styles.statLabel}>Contacts</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.enabledGestures}</Text>
          <Text style={styles.statLabel}>Gestures</Text>
        </View>
      </View>

      <View style={styles.content}>
        {!isEditing ? (
          // View Mode
          <View>
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Icon name="person" size={20} color="#666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Username</Text>
                  <Text style={styles.infoValue}>{profile?.username || 'Not set'}</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Icon name="badge" size={20} color="#666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Full Name</Text>
                  <Text style={styles.infoValue}>{profile?.full_name || 'Not set'}</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Icon name="email" size={20} color="#666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValue}>{user?.email}</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Icon name="phone" size={20} color="#666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Phone</Text>
                  <Text style={styles.infoValue}>{profile?.phone || 'Not set'}</Text>
                </View>
              </View>

              <View style={styles.infoRow}>
                <Icon name="calendar-today" size={20} color="#666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Member Since</Text>
                  <Text style={styles.infoValue}>
                    {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={styles.editButton}
              onPress={() => setIsEditing(true)}
            >
              <Icon name="edit" size={20} color="white" />
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Edit Mode
          <View>
            <View style={styles.formCard}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.username}
                  onChangeText={(text) => setFormData({...formData, username: text})}
                  placeholder="Enter username"
                  editable={!saving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  value={formData.fullName}
                  onChangeText={(text) => setFormData({...formData, fullName: text})}
                  placeholder="Enter full name"
                  editable={!saving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.email}
                  onChangeText={(text) => setFormData({...formData, email: text})}
                  placeholder="Enter email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!saving}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  value={formData.phone}
                  onChangeText={(text) => setFormData({...formData, phone: text})}
                  placeholder="Enter phone number"
                  keyboardType="phone-pad"
                  editable={!saving}
                />
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.cancelButton]}
                  onPress={() => {
                    setIsEditing(false);
                    // Reset form to original values
                    setFormData({
                      username: profile?.username || '',
                      fullName: profile?.full_name || '',
                      email: user?.email || '',
                      phone: profile?.phone || '',
                      avatarUrl: profile?.avatar_url || null
                    });
                  }}
                  disabled={saving}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.saveButton]}
                  onPress={handleUpdateProfile}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Settings Section */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Account Settings</Text>
          
          <TouchableOpacity 
            style={styles.settingRow}
            onPress={handleResetPassword}
          >
            <Icon name="lock" size={20} color="#666" />
            <Text style={styles.settingText}>Change Password</Text>
            <Icon name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <Icon name="notifications" size={20} color="#666" />
            <Text style={styles.settingText}>Notification Preferences</Text>
            <Icon name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <Icon name="privacy-tip" size={20} color="#666" />
            <Text style={styles.settingText}>Privacy Settings</Text>
            <Icon name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <Icon name="help" size={20} color="#666" />
            <Text style={styles.settingText}>Help & Support</Text>
            <Icon name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <Icon name="info" size={20} color="#666" />
            <Text style={styles.settingText}>About</Text>
            <Icon name="chevron-right" size={20} color="#ccc" />
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Danger Zone</Text>
          
          <TouchableOpacity 
            style={styles.logoutButton}
            onPress={handleLogout}
          >
            <Icon name="logout" size={20} color="#e74c3c" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.deleteButton}
            onPress={handleDeleteAccount}
          >
            <Text style={styles.deleteText}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        {/* App Version */}
        <Text style={styles.versionText}>Version 1.0.0</Text>
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
    backgroundColor: '#e74c3c',
    alignItems: 'center',
    paddingVertical: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 10,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: 'white',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
  },
  avatarText: {
    fontSize: 40,
    color: 'white',
    fontWeight: 'bold',
  },
  avatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 50,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editAvatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#3498db',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  userName: {
    fontSize: 24,
    color: 'white',
    fontWeight: 'bold',
  },
  userEmail: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 5,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 15,
    marginTop: -20,
    justifyContent: 'center',
  },
  statCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 70,
    margin: 5,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  activeStatCard: {
    backgroundColor: '#fff3e0',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
  },
  content: {
    padding: 20,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoContent: {
    marginLeft: 15,
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#999',
  },
  infoValue: {
    fontSize: 16,
    color: '#333',
    marginTop: 2,
  },
  editButton: {
    backgroundColor: '#e74c3c',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  editButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f8f9fa',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  actionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  saveButton: {
    backgroundColor: '#e74c3c',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 15,
  },
  dangerZone: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginBottom: 15,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#fce4e4',
    borderRadius: 8,
    marginBottom: 10,
  },
  logoutText: {
    color: '#e74c3c',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 10,
  },
  deleteButton: {
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e74c3c',
    borderRadius: 8,
  },
  deleteText: {
    color: '#e74c3c',
    fontSize: 14,
  },
  versionText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginBottom: 20,
  },
});

export default ProfileScreen;