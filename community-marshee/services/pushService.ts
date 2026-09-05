import * as admin from "firebase-admin";
import path from "path";
import fs from "fs";
import DeviceToken from "../models/DeviceToken";

const DEBUG_LOG_PATH = path.join(process.cwd(), ".cursor", "debug.log");
function dbg(payload: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, JSON.stringify(payload) + "\n");
  } catch {
    // ignore
  }
}

let messaging: admin.messaging.Messaging | null = null;

console.log("[PUSH] pushService initialized");
console.log("[PUSH] messaging:", messaging);
console.log("[PUSH] admin.apps:", admin.apps);
console.log("[PUSH] process.env.FIREBASE_SERVICE_ACCOUNT_PATH:", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
console.log("[PUSH] path.join(process.cwd(), 'config', 'serviceAccountKey.json'):", path.join(process.cwd(), 'config', 'serviceAccountKey.json'));
/**
 * Initialize Firebase Admin using the service account key file.
 * Uses credential.cert() with the full JSON (as downloaded from Firebase Console).
 * Set FIREBASE_SERVICE_ACCOUNT_PATH in .env to override the key file path.
 *
 * If FCM returns "Request is missing required authentication credential", the service
 * account needs IAM permission to send messages: in Google Cloud Console → IAM & Admin
 * → find firebase-adminsdk-*@<project>.iam.gserviceaccount.com → add role
 * "Firebase Cloud Messaging API Admin" (roles/firebasecloudmessaging.admin).
 */
function initFirebaseAdmin(): void {
  // #region agent log
  const _payload0 = { location: "pushService.ts:initFirebaseAdmin:entry", message: "init entered", data: { cwd: process.cwd(), appsLength: admin.apps.length, hasFIREBASE_PATH: !!process.env.FIREBASE_SERVICE_ACCOUNT_PATH }, hypothesisId: "A,E", timestamp: Date.now() };
  dbg(_payload0);
  fetch("http://127.0.0.1:7244/ingest/38100e0f-92fa-450a-945d-66f8621d0c96", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(_payload0) }).catch(() => {});
  // #endregion
  if (admin.apps.length > 0) {
    messaging = admin.messaging();
    return;
  }

  const keyPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), "config", "serviceAccountKey.json");

  try {
    const resolvedPath = path.resolve(
      path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath)
    );
    // #region agent log
    const _payload1 = { location: "pushService.ts:initFirebaseAdmin:resolvedPath", message: "path resolved", data: { resolvedPath, fileExists: fs.existsSync(resolvedPath) }, hypothesisId: "A", timestamp: Date.now() };
    dbg(_payload1);
    fetch("http://127.0.0.1:7244/ingest/38100e0f-92fa-450a-945d-66f8621d0c96", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(_payload1) }).catch(() => {});
    // #endregion
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Service account file not found: ${resolvedPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    if (!raw.project_id || !raw.private_key || !raw.client_email) {
      throw new Error("Service account JSON must include project_id, private_key, and client_email.");
    }
    // Ensure private_key has real newlines (JSON may have literal \n)
    if (typeof raw.private_key === "string" && raw.private_key.includes("\\n")) {
      raw.private_key = raw.private_key.replace(/\\n/g, "\n");
    }
    // #region agent log
    const _payload2 = { location: "pushService.ts:initFirebaseAdmin:afterParse", message: "service account parsed", data: { project_id: raw.project_id, hasPrivateKey: !!raw.private_key, hasClientEmail: !!raw.client_email, privateKeyLength: typeof raw.private_key === "string" ? raw.private_key.length : 0 }, hypothesisId: "B", timestamp: Date.now() };
    dbg(_payload2);
    fetch("http://127.0.0.1:7244/ingest/38100e0f-92fa-450a-945d-66f8621d0c96", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(_payload2) }).catch(() => {});
    // #endregion

    // cert() accepts the full Google service account JSON (snake_case)
    admin.initializeApp({
      credential: admin.credential.cert(raw),
      projectId: raw.project_id,
    });
    messaging = admin.messaging();
    // #region agent log
    const _payload3 = { location: "pushService.ts:initFirebaseAdmin:afterInit", message: "initializeApp done", data: { projectId: raw.project_id, messagingNotNull: !!messaging }, hypothesisId: "B,D,E", timestamp: Date.now() };
    dbg(_payload3);
    fetch("http://127.0.0.1:7244/ingest/38100e0f-92fa-450a-945d-66f8621d0c96", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(_payload3) }).catch(() => {});
    // #endregion
    console.log("[PUSH] Firebase Admin initialized for project:", raw.project_id);
  } catch (err) {
    console.warn(
      "[PUSH] Firebase Admin init failed (no push to tray/lock screen).",
      err instanceof Error ? err.message : err
    );
  }
}

initFirebaseAdmin();

export type PushData = Record<string, string>;

/**
 * Get all FCM tokens for a user and send a push to each device.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data: PushData
): Promise<void> {
  if (!messaging) return;

  const tokens = await DeviceToken.find({ user: userId }).select("fcmToken").lean();
  if (tokens.length === 0) return;

  const message: admin.messaging.MulticastMessage = {
    tokens: tokens.map((t) => t.fcmToken),
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
    ),
    android: {
      priority: "high",
      notification: {
        channelId: "marshee_default",
        priority: "high",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          contentAvailable: true,
        },
      },
    },
  };

  const result = await messaging.sendEachForMulticast(message);
  if (result.failureCount > 0) {
    logSendFailures(result.responses, "Send");
  }
}

/** Log send failures and hint at FCM API if it looks like an auth error. */
function logSendFailures(
  responses: admin.messaging.SendResponse[],
  label: string
): void {
  let seenAuthError = false;
  responses.forEach((resp, i) => {
    if (!resp.success && resp.error) {
      const msg = resp.error.message || "";
      if (
        msg.includes("authentication credential") ||
        msg.includes("OAuth 2") ||
        msg.includes("UNAUTHENTICATED")
      ) {
        seenAuthError = true;
      }
      console.error(`[PUSH] ${label} failed for token index ${i}:`, msg);
    }
  });
  if (seenAuthError) {
    console.error(
      "[PUSH] Fix: Enable 'Firebase Cloud Messaging API' in Google Cloud Console:",
      "https://console.cloud.google.com/apis/library/fcm.googleapis.com"
    );
  }
}

/**
 * Send push to multiple users (e.g. broadcast). One message per device token.
 */
export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data: PushData
): Promise<void> {
  console.log("[sendPushToUsers] called with:", { userIds, title, body, data });

  console.log("[PUSH] messaging:", messaging);

  if (!messaging) {
    console.error("[sendPushToUsers] Error: messaging not initialized.");
    return;
  }

  if (userIds.length === 0) {
    console.error("[sendPushToUsers] Error: userIds array is empty.");
    return;
  }

  let tokens;
  try {
    tokens = await DeviceToken.find({ user: { $in: userIds } })
      .select("fcmToken")
      .lean();
  } catch (err) {
    console.error("[sendPushToUsers] Error while fetching device tokens:", err);
    throw err;
  }

  if (!tokens || tokens.length === 0) {
    console.error("[sendPushToUsers] Error: No device tokens found for provided userIds.", { userIds });
    return;
  }

  let message: admin.messaging.MulticastMessage;
  try {
    message = {
      tokens: tokens.map((t) => t.fcmToken),
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
      ),
      android: {
        priority: "high",
        notification: {
          channelId: "marshee_default",
          priority: "high",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            contentAvailable: true,
          },
        },
      },
    };
    console.log("[PUSH] message:", message);
  } catch (err) {
    console.error("[sendPushToUsers] Error while constructing message object:", err);
    console.log("[PUSH] err:", err);
    throw err;
  }

  let result;
  try {
    result = await messaging.sendEachForMulticast(message);
    console.log("[PUSH] result:", result);
  } catch (err) {
    console.error("[sendPushToUsers] Error while sending FCM multicast message:", err);
    throw err;
  }

  if (result.failureCount > 0) {
    try {
      logSendFailures(result.responses, "Broadcast send");
    } catch (err) {
      console.error("[sendPushToUsers] Error while logging send failures:", err);
    }
  }
}

export function isPushAvailable(): boolean {
  return messaging !== null;
}
