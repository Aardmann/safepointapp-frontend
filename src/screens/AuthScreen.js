import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { supabase } from '../services/supabase';

const AuthScreen = ({ navigation }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    fullName: ''
  });

  const handleInputChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const validateForm = () => {
    if (!formData.email || !formData.password) {
      Alert.alert('Error', 'Email and password are required');
      return false;
    }
    if (!isLogin && (!formData.username || !formData.phone)) {
      Alert.alert('Error', 'All fields are required for registration');
      return false;
    }
    return true;
  };

  const handleLogin = async () => {
  setLoading(true);
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password,
    });

    if (error) throw error;

    if (data.user) {
      // Try to get user profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      // If profile doesn't exist, create it
      if (profileError && profileError.code === 'PGRST116') {
        console.log('Profile not found, creating one...');
        
        // Create profile from user metadata
        const { data: newProfile, error: createError } = await supabase
          .from('profiles')
          .insert([
            {
              id: data.user.id,
              username: data.user.user_metadata?.username || data.user.email?.split('@')[0],
              full_name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0],
              phone: data.user.user_metadata?.phone || '',
            }
          ])
          .select()
          .single();

        if (createError) throw createError;

        // Create default gesture preferences
        const defaultGestures = [
          'volume_buttons', 'power_button_five', 'all_buttons',
          'back_tap', 'shake', 'sos_motion', 'screen_cover',
          'fall_detection', 'silent_scream'
        ];

        for (const gesture of defaultGestures) {
          await supabase
            .from('gesture_preferences')
            .insert([
              {
                user_id: data.user.id,
                gesture_type: gesture,
                enabled: true,
                sensitivity: 5
              }
            ]);
        }

        // Store user data with new profile
        const userData = {
          id: data.user.id,
          email: data.user.email,
          username: newProfile.username,
          fullName: newProfile.full_name,
          phone: newProfile.phone,
          avatarUrl: newProfile.avatar_url
        };

        await AsyncStorage.setItem('user', JSON.stringify(userData));
        await AsyncStorage.setItem('supabase-session', JSON.stringify(data.session));

        navigation.replace('MainApp');
      } else if (profileError) {
        throw profileError;
      } else {
        // Profile exists
        const userData = {
          id: data.user.id,
          email: data.user.email,
          username: profile.username,
          fullName: profile.full_name,
          phone: profile.phone,
          avatarUrl: profile.avatar_url
        };

        await AsyncStorage.setItem('user', JSON.stringify(userData));
        await AsyncStorage.setItem('supabase-session', JSON.stringify(data.session));

        navigation.replace('mainApp');
      }
    }
  } catch (error) {
    console.error('Login error:', error);
    Alert.alert('Error', error.message || 'Login failed');
  } finally {
    setLoading(false);
  }
};

  const handleRegister = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            username: formData.username,
            full_name: formData.fullName || formData.username,
            phone: formData.phone,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        Alert.alert(
          'Success',
          'Registration successful! Please check your email for verification.',
          [{ text: 'OK', onPress: () => setIsLogin(true) }]
        );

        // Clear form
        setFormData({
          username: '',
          email: '',
          phone: '',
          password: '',
          fullName: ''
        });
      }
    } catch (error) {
      console.error('Registration error:', error);
      Alert.alert('Error', error.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!validateForm()) return;
    
    if (isLogin) {
      handleLogin();
    } else {
      handleRegister();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Icon name="warning" size={80} color="#e74c3c" />
          <Text style={styles.title}>Safety Emergency App</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'Welcome Back!' : 'Create Account'}
          </Text>
        </View>

        <View style={styles.formContainer}>
          {!isLogin && (
            <>
              <View style={styles.inputContainer}>
                <Icon name="person" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Username *"
                  value={formData.username}
                  onChangeText={(text) => handleInputChange('username', text)}
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputContainer}>
                <Icon name="badge" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Full Name (Optional)"
                  value={formData.fullName}
                  onChangeText={(text) => handleInputChange('fullName', text)}
                />
              </View>

              <View style={styles.inputContainer}>
                <Icon name="phone" size={20} color="#666" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number *"
                  value={formData.phone}
                  onChangeText={(text) => handleInputChange('phone', text)}
                  keyboardType="phone-pad"
                />
              </View>
            </>
          )}

          <View style={styles.inputContainer}>
            <Icon name="email" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Email *"
              value={formData.email}
              onChangeText={(text) => handleInputChange('email', text)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Icon name="lock" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password *"
              value={formData.password}
              onChangeText={(text) => handleInputChange('password', text)}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={styles.button}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? 'Login' : 'Register'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => {
              setIsLogin(!isLogin);
              setFormData({
                username: '',
                email: '',
                phone: '',
                password: '',
                fullName: ''
              });
            }}
          >
            <Text style={styles.switchText}>
              {isLogin
                ? "Don't have an account? Register"
                : 'Already have an account? Login'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  formContainer: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 15,
    paddingHorizontal: 15,
    backgroundColor: '#f8f9fa',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#e74c3c',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchText: {
    color: '#e74c3c',
    fontSize: 14,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
  },
  footerText: {
    color: '#999',
    fontSize: 12,
    textAlign: 'center',
  },
});

export default AuthScreen;