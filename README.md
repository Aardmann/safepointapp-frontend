Safety Emergency App - Complete Setup GuideOverview

A React Native Expo mobile application that allows users to trigger emergency alerts through various gestures (shake, volume buttons, power button, etc.). The app notifies emergency contacts via SMS and shares the user's real-time location.

Tech Stack

    Frontend: React Native with Expo

    Backend: Python Flask

    Database & Auth: Supabase (PostgreSQL)

    SMS Service: Twilio (optional)

    Real-time: Socket.IO

Prerequisites

Before you begin, ensure you have the following installed:
Required Software

    Node.js (v16 or higher) - Download

    Python (v3.8 or higher) - Download

    Git - Download

    VS Code (recommended) - Download

    Expo Go app on your mobile device (iOS/Android)

Required Accounts (Free)

    Supabase Account - Sign up

    Twilio Account (optional, for SMS) - Sign up

    Expo Account (optional) - Sign up

Step-by-Step Setup Guide
Step 1: Clone the Repository

Open your terminal/command prompt and run:
bash

# Clone the repository
git clone https://github.com/yourusername/safety-emergency-app.git

# Navigate into the project folder
cd safety-emergency-app

Step 2: Setup Supabase Database

    Create a Supabase Project

        Go to Supabase Dashboard

        Click "New Project"

        Fill in:

            Name: safety-emergency-app

            Database Password: Create a strong password

            Region: Choose closest to you

        Wait for project to initialize (2-3 minutes)

    Get Your API Credentials

        Go to Project Settings → API

        Copy these values (you'll need them later):

            Project URL (looks like: https://xyzabc.supabase.co)

            anon public key (starts with eyJ...)

    Create Database Tables

        In Supabase dashboard, go to SQL Editor

        Click "New Query"

        Copy and paste the entire SQL script from database/schema.sql (provided in the code above)

        Click "Run" to execute

Step 3: Backend Setup
bash

# Navigate to backend folder
cd backend

# Create virtual environment (Python)
# On Windows:
python -m venv venv
venv\Scripts\activate

# On Mac/Linux:
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

Create a .env file in the backend folder:
env

# Flask Configuration
FLASK_ENV=development
FLASK_APP=app.py
FLASK_DEBUG=1
SECRET_KEY=your-super-secret-key-change-this

# Supabase Configuration (from Step 2)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-public-key-here
SUPABASE_SERVICE_KEY=your-service-role-key-here

# Twilio Configuration (optional - skip if you don't have Twilio)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

Step 4: Frontend Setup

Open a new terminal (keep backend terminal running) and run:
bash

# Navigate to frontend folder
cd frontend

# Install Node.js dependencies
npm install

# Install specific dependencies (if any issues)
npm install @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
npm install react-native-screens react-native-safe-area-context
npm install react-native-gesture-handler expo-sensors expo-location
npm install expo-haptics expo-notifications axios socket.io-client
npm install @react-native-async-storage/async-storage react-native-vector-icons
npm install @supabase/supabase-js @react-native-community/slider
npm install expo-image-picker base64-arraybuffer

Create a supabase.js file in frontend/src/services/:
javascript

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace with your Supabase URL and anon key from Step 2
const supabaseUrl = 'https://your-project-id.supabase.co';
const supabaseAnonKey = 'your-anon-public-key-here';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

Step 5: Running the Application

You'll need two terminals running simultaneously:

Terminal 1 - Backend:
bash

cd backend
# Make sure virtual environment is activated
python app.py
# You should see: * Running on http://127.0.0.1:5000

Terminal 2 - Frontend:
bash

cd frontend
npx expo start
# This will show a QR code

Step 6: Run on Your Phone

    Install Expo Go app from App Store (iOS) or Google Play Store (Android)

    Make sure your phone and computer are on the same WiFi network

    Scan the QR code shown in the terminal with:

        iPhone: Use the camera app

        Android: Use the Expo Go app

    The app will load on your phone

Troubleshooting Common Issues
Issue 1: "Network Error" when logging in

Solution:

    Make sure backend is running on port 5000

    Find your computer's IP address:
    bash

    # Windows: ipconfig
    # Mac/Linux: ifconfig

    In AuthScreen.js, change localhost to your IP:
    javascript

    const API_URL = 'http://192.168.1.100:5000'; // Use your actual IP

Issue 2: "PGRST116" error (profile not found)

Solution:

    This means the database trigger didn't create the profile automatically

    Run this SQL in Supabase SQL editor:
    sql

    INSERT INTO public.profiles (id, username, full_name, phone)
    SELECT 
        au.id,
        COALESCE(au.raw_user_meta_data->>'username', split_part(au.email, '@', 1)),
        COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
        au.raw_user_meta_data->>'phone'
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE p.id IS NULL;

Issue 3: Slider component error

Solution:
bash

cd frontend
npm install @react-native-community/slider
npx expo start --clear


Issue 4: Location permissions not working

Solution:

    Check app.json has the correct permissions

    On iOS, you need to add usage descriptions

    On Android, ensure manifest has permissions

Project Structure
text

safety-emergency-app/
├── backend/
│   ├── app.py                 # Main Flask application
│   ├── requirements.txt       # Python dependencies
│   └── .env                   # Environment variables
├── frontend/
│   ├── App.js                 # Main React Native component
│   ├── app.json               # Expo configuration
│   ├── src/
│   │   ├── screens/
│   │   │   ├── AuthScreen.js
│   │   │   ├── HomeScreen.js
│   │   │   ├── GestureSettingsScreen.js
│   │   │   ├── EmergencyContactsScreen.js
│   │   │   ├── AlertHistoryScreen.js
│   │   │   └── ProfileScreen.js
│   │   └── services/
│   │       └── supabase.js    # Supabase client
│   └── package.json           # Node dependencies
└── README.md                  # This file

Features

    Multiple Gesture Triggers:

        Shake phone 5 times

        Press both volume buttons

        Press power button 5 times

        Press all buttons simultaneously

        Back tap (double tap on back)

        SOS motion pattern

        Fall detection

        Screen cover

        Silent scream

    Emergency Alerts:

        SMS notifications to emergency contacts

        Real-time location sharing

        Alert history tracking

        Test mode for safe practice

    User Features:

        Profile management with avatar upload

        Emergency contact management

        Customizable gesture sensitivity

        Alert statistics and history

        Push notifications (optional)

Security Notes

    Never commit your .env file or API keys to GitHub

    Use Supabase Row Level Security (RLS) for data protection

    All passwords are hashed by Supabase Auth

    API endpoints require valid JWT tokens

    Store backups of your Supabase encryption keys

Deployment
Backend Deployment (Render/Heroku)
bash

# Create a Procfile
echo "web: gunicorn app:app" > Procfile

# Deploy to Render (free tier available)
# Connect your GitHub repository and deploy

Frontend Deployment (Expo EAS)
bash

# Build for production
eas build --platform android --profile production
eas build --platform ios --profile production

Contributing

    Fork the repository

    Create a feature branch (git checkout -b feature/AmazingFeature)

    Commit your changes (git commit -m 'Add some AmazingFeature')

    Push to the branch (git push origin feature/AmazingFeature)

    Open a Pull Request

Quick Start (TL;DR)
bash

# Clone and setup
git clone https://github.com/aardmann/safety-emergency-app.git
cd safety-emergency-app

# Backend
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
# Edit .env with your Supabase credentials
python app.py 
# or python3 based on your pyhton version

# Frontend (new terminal)
cd frontend
npm install
# Edit supabase.js with your credentials
npx expo start
# Scan QR code with Expo Go app

# safetyemergencyapp
# safetyemergencyapp
# safepointapp
# safetyemergencyapp
