# Postman Testing Guide - 24-Hour Moderation Endpoints

## Base URL
```
http://localhost:8080/api/v1/report
```
(Replace `localhost:8080` with your server URL)

## Headers (Required for all requests)
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

---

## 1. Report User

**Method:** `POST`  
**URL:** `http://localhost:8080/api/v1/report/user`

**Request Body:**
```json
{
  "reportedUserId": "507f1f77bcf86cd799439011",
  "reason": "Inappropriate behavior",
  "description": "User sent harassing messages"
}
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "User reported successfully. Our team will review your report.",
  "data": {
    "_id": "...",
    "reporter": {...},
    "reportedUser": {...},
    "status": "pending"
  }
}
```

---

## 2. Get Reports Dashboard (24-Hour Tracking)

**Method:** `GET`  
**URL:** `http://localhost:8080/api/v1/report/admin/dashboard`

**Request Body:** None (GET request)

**Query Parameters (Optional):**
- None

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Reports dashboard retrieved successfully.",
  "data": {
    "statistics": {
      "totalPending": 5,
      "overdueCount": 1,
      "urgentCount": 2,
      "resolvedToday": 12
    },
    "reports": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "hoursRemaining": 2.5,
        "isOverdue": false,
        "isUrgent": true,
        "deadlineAt": "2024-01-15T14:30:00Z"
      }
    ],
    "alerts": {
      "hasOverdue": false,
      "hasUrgent": true,
      "message": "⚠️ 2 report(s) approaching deadline!"
    }
  }
}
```

---

## 3. Get Reports List (Admin)

**Method:** `GET`  
**URL:** `http://localhost:8080/api/v1/report/admin/list`

**Query Parameters (Optional):**
```
?status=pending&page=1&limit=20&userId=507f1f77bcf86cd799439011
```

**Request Body:** None

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Reports retrieved successfully.",
  "data": {
    "reports": [...],
    "pagination": {...}
  }
}
```

---

## 4. Resolve Report (Admin Action)

**Method:** `PUT`  
**URL:** `http://localhost:8080/api/v1/report/admin/:reportId/resolve`

**Example URL:** `http://localhost:8080/api/v1/report/admin/507f1f77bcf86cd799439011/resolve`

**Request Body (Resolve with Actions):**
```json
{
  "status": "resolved",
  "deleteContent": true,
  "banUser": true,
  "suspendUser": false,
  "hideContent": false,
  "notes": "User posted inappropriate content multiple times. Permanent ban applied."
}
```

**Request Body (Dismiss Report):**
```json
{
  "status": "dismissed",
  "deleteContent": false,
  "banUser": false,
  "suspendUser": false,
  "notes": "Report was unfounded. No action needed."
}
```

**Request Body (Suspend User):**
```json
{
  "status": "resolved",
  "deleteContent": true,
  "banUser": false,
  "suspendUser": true,
  "suspendUntil": "2024-01-25T00:00:00Z",
  "notes": "User suspended for 7 days for first violation."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Report resolved successfully.",
  "data": {
    "_id": "...",
    "status": "resolved",
    "reviewedBy": {...},
    "reviewedAt": "2024-01-15T10:30:00Z",
    "actionsTaken": {
      "contentDeleted": true,
      "userBanned": true,
      "userSuspended": false,
      "contentHidden": false,
      "notes": "..."
    }
  }
}
```

---

## 5. Ban User

**Method:** `POST`  
**URL:** `http://localhost:8080/api/v1/report/admin/users/:userId/ban`

**Example URL:** `http://localhost:8080/api/v1/report/admin/users/507f1f77bcf86cd799439011/ban`

**Request Body:**
```json
{
  "reason": "Repeated violations of community guidelines. Posted inappropriate content multiple times."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "User banned successfully.",
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "userName": "John Doe",
    "bannedAt": "2024-01-15T10:30:00Z",
    "banReason": "Repeated violations..."
  }
}
```

---

## 6. Suspend User

**Method:** `POST`  
**URL:** `http://localhost:8080/api/v1/report/admin/users/:userId/suspend`

**Example URL:** `http://localhost:8080/api/v1/report/admin/users/507f1f77bcf86cd799439011/suspend`

**Request Body (With End Date):**
```json
{
  "reason": "First violation of community guidelines. Temporary suspension.",
  "suspendUntil": "2024-01-22T00:00:00Z"
}
```

**Request Body (Default 7 Days):**
```json
{
  "reason": "First violation of community guidelines."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "User suspended successfully.",
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "userName": "John Doe",
    "suspendedAt": "2024-01-15T10:30:00Z",
    "suspendedUntil": "2024-01-22T00:00:00Z",
    "suspensionReason": "First violation..."
  }
}
```

---

## 7. Unban User

**Method:** `POST`  
**URL:** `http://localhost:8080/api/v1/report/admin/users/:userId/unban`

**Example URL:** `http://localhost:8080/api/v1/report/admin/users/507f1f77bcf86cd799439011/unban`

**Request Body:** None

**Expected Response (200):**
```json
{
  "success": true,
  "message": "User unbanned successfully.",
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "userName": "John Doe"
  }
}
```

---

## 8. Unsuspend User

**Method:** `POST`  
**URL:** `http://localhost:8080/api/v1/report/admin/users/:userId/unsuspend`

**Example URL:** `http://localhost:8080/api/v1/report/admin/users/507f1f77bcf86cd799439011/unsuspend`

**Request Body:** None

**Expected Response (200):**
```json
{
  "success": true,
  "message": "User unsuspended successfully.",
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "userName": "John Doe"
  }
}
```

---

## 9. Admin Delete Post

**Method:** `DELETE`  
**URL:** `http://localhost:8080/api/v1/report/admin/posts/:postId`

**Example URL:** `http://localhost:8080/api/v1/report/admin/posts/507f1f77bcf86cd799439011`

**Request Body:**
```json
{
  "reason": "Post contained inappropriate content violating community guidelines."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Post deleted successfully by admin.",
  "data": {
    "postId": "507f1f77bcf86cd799439011",
    "reason": "Post contained inappropriate content..."
  }
}
```

---

## 10. Admin Delete Message

**Method:** `DELETE`  
**URL:** `http://localhost:8080/api/v1/report/admin/messages/:messageId`

**Example URL:** `http://localhost:8080/api/v1/report/admin/messages/507f1f77bcf86cd799439011`

**Request Body:**
```json
{
  "reason": "Message contained harassing content."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Message deleted successfully by admin.",
  "data": {
    "messageId": "507f1f77bcf86cd799439011",
    "reason": "Message contained harassing content."
  }
}
```

---

## 11. Admin Delete Comment

**Method:** `DELETE`  
**URL:** `http://localhost:8080/api/v1/report/admin/comments/:commentId`

**Example URL:** `http://localhost:8080/api/v1/report/admin/comments/507f1f77bcf86cd799439011`

**Request Body:**
```json
{
  "reason": "Comment contained spam or inappropriate content."
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Comment deleted successfully by admin.",
  "data": {
    "commentId": "507f1f77bcf86cd799439011",
    "reason": "Comment contained spam..."
  }
}
```

---

## Quick Reference Table

| Endpoint | Method | URL Pattern | Requires Body |
|----------|--------|-------------|---------------|
| Report User | POST | `/user` | ✅ Yes |
| Dashboard | GET | `/admin/dashboard` | ❌ No |
| List Reports | GET | `/admin/list` | ❌ No |
| Resolve Report | PUT | `/admin/:reportId/resolve` | ✅ Yes |
| Ban User | POST | `/admin/users/:userId/ban` | ✅ Yes |
| Suspend User | POST | `/admin/users/:userId/suspend` | ✅ Yes |
| Unban User | POST | `/admin/users/:userId/unban` | ❌ No |
| Unsuspend User | POST | `/admin/users/:userId/unsuspend` | ❌ No |
| Delete Post | DELETE | `/admin/posts/:postId` | ✅ Yes |
| Delete Message | DELETE | `/admin/messages/:messageId` | ✅ Yes |
| Delete Comment | DELETE | `/admin/comments/:commentId` | ✅ Yes |

---

## Testing Workflow

### Step 1: Create a Report
```
POST /api/v1/report/user
Body: { "reportedUserId": "...", "reason": "...", "description": "..." }
```

### Step 2: Check Dashboard
```
GET /api/v1/report/admin/dashboard
```
- Note the `reportId` from response
- Check `hoursRemaining` (should be ~24)
- Check `isUrgent` and `isOverdue` flags

### Step 3: Resolve Report
```
PUT /api/v1/report/admin/:reportId/resolve
Body: { "status": "resolved", "deleteContent": true, "banUser": true }
```

### Step 4: Verify Actions
- Check that user is banned (try to login as that user)
- Check that content is deleted
- Check report status changed to "resolved"

---

## Common Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Authentication required."
}
```

### 403 Forbidden (Not Admin)
```json
{
  "success": false,
  "message": "Access denied. Admin privileges required."
}
```

### 403 Forbidden (User Banned)
```json
{
  "message": "Your account has been banned. Please contact support if you believe this is an error.",
  "reason": "Repeated violations of community guidelines."
}
```

### 400 Bad Request
```json
{
  "success": false,
  "message": "Valid report ID is required."
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Report not found."
}
```

---

## Notes

1. **All admin endpoints require admin role** - Make sure your JWT token is for an admin user
2. **Replace IDs** - Use actual MongoDB ObjectIds from your database
3. **Date Format** - Use ISO 8601 format: `"2024-01-22T00:00:00Z"`
4. **Testing Suspension** - Set `suspendUntil` to a future date to test suspension
5. **Testing Ban** - Once banned, user cannot authenticate (403 error)
