# Frontend: Get and log FCM token, then send to backend

## Backend (already done)

- **POST /api/v1/notifications/device-token** accepts `{ fcmToken, platform }` with auth.
- When a token is registered, the server logs (in non-production):  
  `[PUSH] Device token registered — userId: ... platform: ... fcmToken: ...`  
  so you can see the token in the backend console and use it in Postman if needed.

---

## Frontend changes

### 1. Get the FCM token and log it

Use Firebase Messaging in your app. Examples below log the token and send it to your backend.

### 2. React Native (`@react-native-firebase/messaging`)

**Install (if not already):**

```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
```

**Request permission, get token, log it, send to backend:**

```javascript
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

async function registerAndSendFCMToken(userToken) {
  try {
    // 1. Request permission (iOS, Android 13+)
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) {
      console.log('Push permission not granted');
      return;
    }

    // 2. Get FCM token
    const fcmToken = await messaging().getToken();
    if (!fcmToken) {
      console.log('No FCM token');
      return;
    }

    // 3. Log it (so you can see in Metro/device log and use in Postman)
    console.log('FCM token:', fcmToken);
    console.log('Platform:', Platform.OS);

    // 4. Send to your backend
    const API_BASE = 'http://192.168.31.189:8080'; // or your server URL
    const res = await fetch(`${API_BASE}/api/v1/notifications/device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        fcmToken,
        platform: Platform.OS, // 'ios' | 'android'
      }),
    });
    const data = await res.json();
    console.log('Device token API response:', data);
  } catch (e) {
    console.error('FCM token error:', e);
  }
}
```

**When to call:** After user logs in (you have `userToken`). Example:

```javascript
// After successful login, when you have the JWT:
const userToken = response.data.token; // or however you get the JWT
await registerAndSendFCMToken(userToken);
```

**Token refresh (optional but recommended):** Re-register when Firebase refreshes the token:

```javascript
messaging().onTokenRefresh(async (newToken) => {
  console.log('FCM token refreshed:', newToken);
  const userToken = await getStoredUserToken(); // your auth storage
  if (userToken) {
    await fetch(`${API_BASE}/api/v1/notifications/device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        fcmToken: newToken,
        platform: Platform.OS,
      }),
    });
  }
});
```

---

### 3. Android (Kotlin, Firebase Messaging)

```kotlin
FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
  if (!task.isSuccessful) return@addOnCompleteListener
  val token = task.result ?: return@addOnCompleteListener
  Log.d("FCM", "FCM token: $token")
  // Send to backend: POST /api/v1/notifications/device-token
  // Body: { "fcmToken": token, "platform": "android" }
  // Header: Authorization: Bearer <userJwt>
}
```

---

### 4. iOS (Swift, Firebase Messaging)

```swift
Messaging.messaging().token { token, error in
  guard let token = token else { return }
  print("FCM token:", token)
  // Send to backend: POST /api/v1/notifications/device-token
  // Body: { "fcmToken": token, "platform": "ios" }
  // Header: Authorization: Bearer <userJwt>
}
```

---

## Summary

| Where        | What to do |
|-------------|------------|
| **Backend** | Already logs `fcmToken` when device-token is called (in non-production). No extra change needed. |
| **Frontend** | 1) Get token with `messaging().getToken()` (or native equivalent). 2) `console.log` / `print` / `Log.d` the token. 3) POST to `/api/v1/notifications/device-token` with that token and user JWT. |

After this, the backend console will show the FCM token when the app registers it, and you can copy that token into Postman for testing if needed.
