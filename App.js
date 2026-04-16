import React, { useEffect, useState, useCallback, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, AppState } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// Screens
import HomeScreen            from './src/screens/HomeScreen';
import GestureSettingsScreen from './src/screens/GestureSettingsScreen';
import EmergencyContactsScreen from './src/screens/EmergencyContactsScreen';
import AlertHistoryScreen    from './src/screens/AlertHistoryScreen';
import ProfileScreen         from './src/screens/ProfileScreen';
import AuthScreen            from './src/screens/AuthScreen';

// Services
import gestureService              from './src/services/GestureService';
import { setAuthFailureCallback }  from './src/services/api';

// ── Notification handler (shown while app is foregrounded) ─────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Home:     'home',
            Gestures: 'touch-app',
            Contacts: 'contacts',
            History:  'history',
            Profile:  'person',
          };
          return <MaterialIcons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarActiveTintColor:   '#e74c3c',
        tabBarInactiveTintColor: 'gray',
        headerStyle:             { backgroundColor: '#e74c3c' },
        headerTintColor:         '#fff',
        headerTitleStyle:        { fontWeight: 'bold' },
      })}
    >
      <Tab.Screen name="Home"     component={HomeScreen}             options={{ title: 'Home' }} />
      <Tab.Screen name="Gestures" component={GestureSettingsScreen}  options={{ title: 'Gestures' }} />
      <Tab.Screen name="Contacts" component={EmergencyContactsScreen} options={{ title: 'Contacts' }} />
      <Tab.Screen name="History"  component={AlertHistoryScreen}     options={{ title: 'History' }} />
      <Tab.Screen name="Profile"  component={ProfileScreen}          options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading,       setIsLoading]       = useState(true);
  const appStateRef = useRef(AppState.currentState);

  // ── Auth check ───────────────────────────────────────────────────────────
  const checkAuth = useCallback(async () => {
    try {
      const [userData, token] = await Promise.all([
        AsyncStorage.getItem('user'),
        AsyncStorage.getItem('access_token'),
      ]);
      const authed = !!(userData && token);
      setIsAuthenticated(authed);

      if (authed) {
        gestureService.updateUserSession();
        // Ensure service is listening (idempotent)
        if (!gestureService.isListening) gestureService.startListening();
      } else {
        gestureService.stopListening();
      }
    } catch (err) {
      console.error('[App] checkAuth error:', err);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Register auth-failure callback so expired tokens navigate to login
    setAuthFailureCallback(() => {
      setIsAuthenticated(false);
      gestureService.stopListening();
    });

    checkAuth();
    _requestNotificationPerms();

    // Initialize gesture service (registers background task etc.)
    gestureService.initialize();

    // Re-check auth when app returns to foreground
    const sub = AppState.addEventListener('change', (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        checkAuth();
      }
      appStateRef.current = next;
    });

    return () => {
      sub.remove();
      // Do NOT stop gesture service on unmount — we want it alive in background.
      // It will be stopped by checkAuth() if the user is not authenticated.
    };
  }, [checkAuth]);

  const _requestNotificationPerms = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') console.log('[App] Notification perms denied');
    } catch (e) {
      console.error('[App] Notification perm error:', e);
    }
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
          {isAuthenticated ? (
            <Stack.Screen name="MainApp" component={HomeTabs} />
          ) : (
            <Stack.Screen
              name="Auth"
              component={AuthScreen}
              initialParams={{ onLogin: checkAuth }}
            />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}