import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, AppState } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// Import screens
import HomeScreen from './src/screens/HomeScreen';
import GestureSettingsScreen from './src/screens/GestureSettingsScreen';
import EmergencyContactsScreen from './src/screens/EmergencyContactsScreen';
import AlertHistoryScreen from './src/screens/AlertHistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/AuthScreen';

// Import gesture service
import gestureService from './src/services/GestureService';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          
          if (route.name === 'Home') iconName = 'home';
          else if (route.name === 'Gestures') iconName = 'touch-app';
          else if (route.name === 'Contacts') iconName = 'contacts';
          else if (route.name === 'History') iconName = 'history';
          else if (route.name === 'Profile') iconName = 'person';
          
          return <MaterialIcons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#e74c3c',
        tabBarInactiveTintColor: 'gray',
        headerStyle: { backgroundColor: '#e74c3c' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Gestures" component={GestureSettingsScreen} options={{ title: 'Gestures' }} />
      <Tab.Screen name="Contacts" component={EmergencyContactsScreen} options={{ title: 'Contacts' }} />
      <Tab.Screen name="History" component={AlertHistoryScreen} options={{ title: 'History' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);

  const checkAuthStatus = useCallback(async () => {
    try {
      const userData = await AsyncStorage.getItem('user');
      const token = await AsyncStorage.getItem('access_token');
      
      const authenticated = !!(userData && token);
      setIsAuthenticated(authenticated);
      
      if (authenticated) {
        // Update gesture service with user session
        gestureService.updateUserSession();
        gestureService.startListening();
      } else {
        gestureService.stopListening();
      }
      
      console.log('Auth status:', authenticated ? 'Authenticated' : 'Not authenticated');
    } catch (error) {
      console.error('Error checking auth status:', error);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
    
    // Request notification permissions
    requestNotificationPermissions();
    
    // Listen for app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
    };
  }, [checkAuthStatus]);

  const handleAppStateChange = (nextAppState) => {
    if (appState.match(/inactive|background/) && nextAppState === 'active') {
      // App came to foreground, check auth status again
      checkAuthStatus();
    }
    setAppState(nextAppState);
  };

  const requestNotificationPermissions = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Notification permissions not granted');
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
    }
  };

  const handleAuthStateChange = () => {
    checkAuthStatus();
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!isAuthenticated ? (
            <Stack.Screen 
              name="Auth" 
              component={AuthScreen}
              initialParams={{ onLogin: handleAuthStateChange }}
            />
          ) : (
            <Stack.Screen 
              name="MainApp" 
              component={HomeTabs}
            />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}