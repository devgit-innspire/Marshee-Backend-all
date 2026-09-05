/**
 * Push notification service for the app.
 * Backend uses config/serviceAccountKey.json (Firebase project: petphoneapp-8e663).
 *
 * Requires: @react-native-firebase/app and @react-native-firebase/messaging
 * Install: npm install @react-native-firebase/app @react-native-firebase/messaging
 *
 * iOS: Add Push Notifications + Background Modes (Remote notifications) in Xcode.
 * Android: Add google-services.json and create notification channel "marshee_default".
 */

import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

const DEVICE_TOKEN_PATH = '/api/v1/notifications/device-token';

export type PushData = {
  type?: string;
  id?: string;
  groupId?: string;
  messageId?: string;
  postId?: string;
  commentId?: string;
  [key: string]: string | undefined;
};

/**
 * Request permission, get FCM token, send to backend, and log it.
 * Call this after the user logs in (when you have the JWT).
 */
export async function registerPushNotifications(
  apiBaseUrl: string,
  userToken: string
): Promise<string | null> {
  try {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) {
      console.log('[PUSH] Permission not granted');
      return null;
    }

    const fcmToken = await messaging().getToken();
    if (!fcmToken) {
      console.log('[PUSH] No FCM token');
      return null;
    }

    console.log('[PUSH] FCM token:', fcmToken);
    console.log('[PUSH] Platform:', Platform.OS);

    const url = apiBaseUrl.replace(/\/$/, '') + DEVICE_TOKEN_PATH;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        fcmToken,
        platform: Platform.OS as 'ios' | 'android',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[PUSH] Device token API error:', res.status, data);
      return fcmToken;
    }
    console.log('[PUSH] Device token registered:', data);
    return fcmToken;
  } catch (e) {
    console.error('[PUSH] Register error:', e);
    return null;
  }
}

/**
 * Call once at app init. When FCM refreshes the token, re-register with backend.
 */
export function setupTokenRefresh(
  apiBaseUrl: string,
  getStoredUserToken: () => Promise<string | null>
): () => void {
  const unsubscribe = messaging().onTokenRefresh(async (newToken) => {
    console.log('[PUSH] Token refreshed:', newToken);
    const userToken = await getStoredUserToken();
    if (!userToken) return;
    const url = apiBaseUrl.replace(/\/$/, '') + DEVICE_TOKEN_PATH;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          fcmToken: newToken,
          platform: Platform.OS as 'ios' | 'android',
        }),
      });
    } catch (e) {
      console.error('[PUSH] Token refresh send failed:', e);
    }
  });
  return unsubscribe;
}

/**
 * Handle notification when app is in foreground (optional: show in-app UI or navigate).
 */
export function setForegroundHandler(
  handler: (remoteMessage: { data?: PushData; notification?: { title?: string; body?: string } }) => void
): () => void {
  const unsubscribe = messaging().onMessage(async (remoteMessage) => {
    handler({
      data: remoteMessage.data as PushData | undefined,
      notification: remoteMessage.notification,
    });
  });
  return unsubscribe;
}

/**
 * Must be called outside of React lifecycle (e.g. index.js) for background/quit state.
 * When user taps the notification, this runs before the app UI is ready.
 */
export function setBackgroundHandler(
  handler: (remoteMessage: { data?: PushData; notification?: { title?: string; body?: string } }) => void | Promise<void>
): void {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    await handler({
      data: remoteMessage.data as PushData | undefined,
      notification: remoteMessage.notification,
    });
  });
}

/**
 * Handle notification open (user tapped notification). Call in your root component (e.g. App.tsx).
 */
export function getInitialNotification(): Promise<{ data?: PushData; notification?: { title?: string; body?: string } } | null> {
  return messaging()
    .getInitialNotification()
    .then((msg) =>
      msg
        ? {
            data: msg.data as PushData | undefined,
            notification: msg.notification,
          }
        : null
    );
}

/**
 * Subscribe to notification opened when app was in background (user tapped notification).
 */
export function onNotificationOpenedApp(
  handler: (remoteMessage: { data?: PushData; notification?: { title?: string; body?: string } }) => void
): () => void {
  const unsubscribe = messaging().onNotificationOpenedApp((remoteMessage) => {
    handler({
      data: remoteMessage.data as PushData | undefined,
      notification: remoteMessage.notification,
    });
  });
  return unsubscribe;
}
