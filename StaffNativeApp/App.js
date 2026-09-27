import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  Platform,
  BackHandler,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import WebView from 'react-native-webview';
import firestore from '@react-native-firebase/firestore';
import TrackPlayer from 'react-native-track-player-next';
import OneSignal from 'react-native-onesignal';

// --- CONFIGURATION ---
const APP_BUILD = '1.0.12'; // bump every APK release
const STAFF_URL = `https://13e-menu.netlify.app/staff.html?v=${APP_BUILD}`;

// --- HELPER FUNCTIONS ---

/**
 * Returns today's date string in YYYY-MM-DD format based on Asia/Jakarta timezone.
 */
function todayJakartaDate() {
  const d = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }),
  );
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// --- MAIN COMPONENT ---

export default function App() {
useEffect(() => {
  OneSignal.initialize("9d4e981e-3184-4ebb-9ac1-cdb4644b1ccd");

  OneSignal.Notifications.requestPermission(true);

  OneSignal.User.pushSubscription.addObserver(state => {
    console.log("Push ID:", state.current.id);
    console.log("Subscribed:", state.current.optedIn);
  });
}, []);

  const webviewRef = useRef(null);
  const [currentDate] = useState(todayJakartaDate());
  const knownOrdersRef = useRef(new Set());

  /** 🔒 TrackPlayer guards */
  const playerInitStarted = useRef(false);
  const playerReady = useRef(false);

  /**
   * 🔥 AUDIO FOCUS WARM-UP (CRITICAL)
   * This removes the "must tap first" issue on Android
   */
  const warmUpAudioFocus = async () => {
    try {
      await TrackPlayer.reset();

      await TrackPlayer.add({
        id: 'warmup',
        url: 'asset:/silence.mp3', // MUST exist in res/raw
        title: 'warmup',
      });

      await TrackPlayer.play();
      await TrackPlayer.pause();
      await TrackPlayer.reset();

      console.log('🔊 Audio focus warmed up');
    } catch (e) {
      console.warn('Audio warmup failed', e);
    }
  };

  /**
   * SAFE TrackPlayer initialization
   * Runs ONCE per app lifetime
   */
  const initPlayerOnce = async () => {
    if (playerInitStarted.current) return;
    playerInitStarted.current = true;

    try {
      await TrackPlayer.setupPlayer();

      // 🔥 THIS IS THE FIX
      await warmUpAudioFocus();

      playerReady.current = true;
      console.log('✅ TrackPlayer ready with audio focus');
    } catch (e) {
      console.warn('❌ TrackPlayer setup failed or already running', e);
    }
  };

  /**
   * Short chime for foreground app
   */
  const playChimeShort = async () => {
    if (!playerReady.current) {
      console.log('🔕 Player not ready, skipping chime');
      return;
    }

    try {
      await TrackPlayer.reset();

      await TrackPlayer.add({
        id: 'chime',
        url:
          Platform.OS === 'android'
            ? 'asset:/sound.mp3'
            : require('./assets/sound.mp3'),
        title: 'New Order',
      });

      await TrackPlayer.play();

      // Stop after 6 seconds
      setTimeout(() => {
        TrackPlayer.stop().catch(() => {});
      }, 6000);
    } catch (e) {
      console.warn('playChimeShort failed', e);
    }
  };

  /**
   * MAIN EFFECT — initialization + listeners
   */
  /**
 * 1️⃣ Firebase permission + topic subscription
 */
useEffect(() => {
}, []);


/**
 * 2️⃣ FCM token + foreground message listener (deleted)
 */


/**
 * 3️⃣ Audio + Firestore order listener
 */
useEffect(() => {
  initPlayerOnce();

  const q = firestore()
    .collection('orders')
    .where('date', '==', currentDate)
    .orderBy('timestamp', 'desc');

  const unsubFirestore = q.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        if (!knownOrdersRef.current.has(change.doc.id)) {
          knownOrdersRef.current.add(change.doc.id);
          playChimeShort();
        }
      }
    });
  });

  return () => {
    unsubFirestore();
  };
}, []);


  /**
   * Android back button handling for WebView
   */
  useEffect(() => {
    const onBackPress = () => {
      if (webviewRef.current) {
        webviewRef.current.goBack();
        return true;
      }
      return false;
    };

    BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () =>
      BackHandler.removeEventListener('hardwareBackPress', onBackPress);
  }, []);

  // --- RENDER ---
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.title}>📋 13e Staff (Native)</Text>
      </View>

      <WebView
        ref={webviewRef}
        source={{ uri: STAFF_URL }}
        style={{ flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        incognito={true}
      />
    </SafeAreaView>
  );
}

// --- STYLES ---

const styles = StyleSheet.create({
  header: {
    padding: 10,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
});
