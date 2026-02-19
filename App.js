import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import screens
import HomeScreen from './src/screens/HomeScreen';
import GestureSettingsScreen from './src/screens/GestureSettingsScreen';
import EmergencyContactsScreen from './src/screens/EmergencyContactsScreen';
import AlertHistoryScreen from './src/screens/AlertHistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/AuthScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Create a separate Home tab navigator if needed
function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          
          if (route.name === 'Home') {
            iconName = 'home';
          } else if (route.name === 'Gestures') {
            iconName = 'touch-app';
          } else if (route.name === 'Contacts') {
            iconName = 'contacts';
          } else if (route.name === 'History') {
            iconName = 'history';
          } else if (route.name === 'Profile') {
            iconName = 'person';
          } 
          
          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#e74c3c',
        tabBarInactiveTintColor: 'gray',
        headerStyle: {
          backgroundColor: '#e74c3c',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeScreen} 
        options={{ 
          title: 'Safety Home',
          tabBarLabel: 'Home'
        }}
      />
      <Tab.Screen 
        name="Gestures" 
        component={GestureSettingsScreen} 
        options={{ 
          title: 'Gesture Settings',
          tabBarLabel: 'Gestures'
        }}
      />
      <Tab.Screen 
        name="Contacts" 
        component={EmergencyContactsScreen} 
        options={{ 
          title: 'Emergency Contacts',
          tabBarLabel: 'Contacts'
        }}
      />
      <Tab.Screen 
        name="History" 
        component={AlertHistoryScreen} 
        options={{ 
          title: 'Alert History',
          tabBarLabel: 'History'
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen} 
        options={{ 
          title: 'My Profile',
          tabBarLabel: 'Profile'
        }}
      />
      {/* Uncomment for debugging */}
      {/* <Tab.Screen 
        name="Debug" 
        component={DebugScreen} 
        options={{ 
          title: 'Debug',
          tabBarLabel: 'Debug'
        }}
      /> */}
    </Tab.Navigator>
  );
}

// Main app navigator
function AppNavigator({ user }) {
  return (
    <Stack.Navigator>
      {!user ? (
        // Auth stack
        <Stack.Screen 
          name="Auth" 
          component={AuthScreen} 
          options={{ headerShown: false }}
        />
      ) : (
        <Stack.Screen 
          name="MainApp" 
          component={HomeTabs} 
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    checkUserSession();
  }, []);

  const checkUserSession = async () => {
    try {
      const userData = await AsyncStorage.getItem('user');
      if (userData) {
        setUser(JSON.parse(userData));
      }
    } catch (error) {
      console.error('Error checking user session:', error);
    } finally {
      setIsLoading(false);
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
        <AppNavigator user={user} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}