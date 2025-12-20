// index.js (Modified)

import { AppRegistry, Platform } from 'react-native'; // <-- Re-added Platform for BG check
import App from './App';
import { name as appName } from './app.json';
import messaging from '@react-native-firebase/messaging'; // <-- Re-added
import TrackPlayer from 'react-native-track-player-next';

// Register playback service FIRST
TrackPlayer.registerPlaybackService(() => require('./service'));

// **BACKGROUND FCM HANDLER (CRITICAL FOR KILLED STATE)**
messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('Background message:', remoteMessage);

  try {
    // CRITICAL: Setup player in the background context
    await TrackPlayer.setupPlayer().catch(() => {});
    
    // Reset player to ensure no tracks are left over
    await TrackPlayer.reset(); 

    await TrackPlayer.add({
      id: 'bg-chime',
      url:
        Platform.OS === 'android'
          ? 'asset:/sound.mp3'
          : require('./assets/sound.mp3'),
      title: 'New order',
    });

    await TrackPlayer.play();

    // stop sound after 6s (Using same duration as your App.js)
    setTimeout(() => {
      TrackPlayer.stop().catch(() => {});
    }, 6000);

  } catch (e) {
    console.warn('BG sound failed:', e);
  }
});

// Register app ONCE
AppRegistry.registerComponent(appName, () => App);