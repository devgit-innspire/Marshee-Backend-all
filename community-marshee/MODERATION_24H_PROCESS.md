# 24-Hour Moderation Response Process

## Overview

This document describes the 24-hour moderation response process implemented to comply with Apple App Store Guideline 1.2 for user-generated content.

## Process Flow

### 1. User Reports Content/User

- Users can report other users or specific content (posts, messages, comments)
- Reports are created with status: `pending`
- Timestamp is automatically recorded (`createdAt`)

**Endpoint:** `POST /api/v1/report/user`

### 2. Admin Dashboard - 24-Hour Tracking

Admins can view all pending reports with real-time 24-hour tracking:

**Endpoint:** `GET /api/v1/report/admin/dashboard`

**Response includes:**
- All pending reports sorted by oldest first (priority)
- For each report:
  - `hoursRemaining`: Time left until 24-hour deadline
  - `isOverdue`: Boolean flag if past 24 hours
  - `isUrgent`: Boolean flag if less than 4 hours remaining
  - `deadlineAt`: Exact deadline timestamp
- Statistics:
  - Total pending reports
  - Overdue count
  - Urgent count (approaching deadline)
  - Resolved today count
- Alerts for overdue/urgent reports

### 3. Admin Actions (Within 24 Hours)

Admins must take action on reports within 24 hours. Available actions:

#### Resolve Report

**Endpoint:** `PUT /api/v1/report/admin/:reportId/resolve`

**Request Body:**
```json
{
  "status": "resolved" | "dismissed",
  "deleteContent": true,        // Optional: Delete reported content
  "banUser": true,              // Optional: Ban the reported user
  "suspendUser": true,          // Optional: Suspend the reported user
  "suspendUntil": "2024-01-20", // Optional: Suspension end date
  "hideContent": true,          // Optional: Hide content instead of deleting
  "notes": "Admin notes"        // Optional: Internal notes
}
```

**Actions Available:**
- Delete reported content (post/message/comment)
- Hide content (mark as hidden)
- Ban user (permanent)
- Suspend user (temporary, with end date)

#### Ban User

**Endpoint:** `POST /api/v1/report/admin/users/:userId/ban`

**Request Body:**
```json
{
  "reason": "Violation of community guidelines"
}
```

#### Suspend User

**Endpoint:** `POST /api/v1/report/admin/users/:userId/suspend`

**Request Body:**
```json
{
  "reason": "Temporary suspension for inappropriate behavior",
  "suspendUntil": "2024-01-20T00:00:00Z"  // Optional, defaults to 7 days
}
```

#### Delete Content (Admin)

- **Delete Post:** `DELETE /api/v1/report/admin/posts/:postId`
- **Delete Message:** `DELETE /api/v1/report/admin/messages/:messageId`
- **Delete Comment:** `DELETE /api/v1/report/admin/comments/:commentId`

**Request Body:**
```json
{
  "reason": "Removed for violating community guidelines"
}
```

### 4. Report Status Tracking

Reports have the following statuses:
- `pending`: Awaiting admin review
- `reviewed`: Under review by admin
- `resolved`: Action taken, issue resolved
- `dismissed`: Report found to be invalid

### 5. 24-Hour Deadline Calculation

- **Deadline:** 24 hours from report creation (`createdAt`)
- **Hours Remaining:** Calculated as `24 - hoursSinceCreation`
- **Overdue:** Reports past 24-hour deadline
- **Urgent:** Reports with less than 4 hours remaining

## Database Schema

### Report Model Updates

```typescript
{
  // Existing fields
  reporter: ObjectId,
  reportedUser: ObjectId,
  reason: string,
  description?: string,
  status: "pending" | "reviewed" | "resolved" | "dismissed",
  reviewedBy?: ObjectId,
  reviewedAt?: Date,
  
  // New fields for content reporting
  reportedPost?: ObjectId,
  reportedMessage?: ObjectId,
  reportedComment?: ObjectId,
  
  // Actions taken tracking
  actionsTaken?: {
    contentDeleted?: boolean,
    userBanned?: boolean,
    userSuspended?: boolean,
    contentHidden?: boolean,
    notes?: string
  }
}
```

### User Model Updates

```typescript
{
  // Moderation fields
  isBanned: boolean,
  isSuspended: boolean,
  suspendedUntil?: Date,
  banReason?: string,
  suspensionReason?: string,
  bannedBy?: ObjectId,
  suspendedBy?: ObjectId,
  bannedAt?: Date,
  suspendedAt?: Date
}
```

## API Endpoints Summary

### User Endpoints
- `POST /api/v1/report/user` - Report a user or content

### Admin Endpoints
- `GET /api/v1/report/admin/list` - List all reports (with filters)
- `GET /api/v1/report/admin/dashboard` - Dashboard with 24-hour tracking
- `PUT /api/v1/report/admin/:reportId/resolve` - Resolve a report with actions
- `POST /api/v1/report/admin/users/:userId/ban` - Ban a user
- `POST /api/v1/report/admin/users/:userId/suspend` - Suspend a user
- `POST /api/v1/report/admin/users/:userId/unban` - Unban a user
- `POST /api/v1/report/admin/users/:userId/unsuspend` - Unsuspend a user
- `DELETE /api/v1/report/admin/posts/:postId` - Delete post (admin)
- `DELETE /api/v1/report/admin/messages/:messageId` - Delete message (admin)
- `DELETE /api/v1/report/admin/comments/:commentId` - Delete comment (admin)

## Compliance Verification

### For Apple App Store Review

This implementation provides:

1. ✅ **24-Hour Response Tracking**
   - Dashboard shows hours remaining for each report
   - Alerts for overdue reports
   - Statistics on response times

2. ✅ **Content Removal**
   - Admins can delete objectionable content
   - Content can be hidden or permanently deleted
   - Actions are tracked in report records

3. ✅ **User Ejection**
   - Admins can ban users (permanent removal)
   - Admins can suspend users (temporary removal)
   - Banned/suspended users are tracked in database

4. ✅ **Action Tracking**
   - All actions taken are recorded in `actionsTaken` field
   - Admin who took action is tracked (`reviewedBy`)
   - Timestamp of action is recorded (`reviewedAt`)

5. ✅ **Audit Trail**
   - Complete history of reports and actions
   - User ban/suspension reasons stored
   - Content deletion reasons stored

## Usage Examples

### Check Dashboard for Urgent Reports

```bash
GET /api/v1/report/admin/dashboard
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "statistics": {
      "totalPending": 5,
      "overdueCount": 1,
      "urgentCount": 2,
      "resolvedToday": 12
    },
    "reports": [
      {
        "_id": "...",
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

### Resolve Report with Actions

```bash
PUT /api/v1/report/admin/507f1f77bcf86cd799439011/resolve
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "status": "resolved",
  "deleteContent": true,
  "banUser": true,
  "notes": "User posted inappropriate content multiple times. Permanent ban applied."
}
```

## Monitoring & Alerts

### Recommended Monitoring

1. **Daily Review:** Check dashboard for overdue reports
2. **Alert System:** Set up notifications for:
   - Reports approaching 4-hour mark
   - Reports past 24-hour deadline
3. **Weekly Report:** Review statistics on response times

### Best Practices

1. Review dashboard at least twice daily
2. Prioritize overdue reports first
3. Document all actions taken in `notes` field
4. Ban users only for severe violations
5. Use suspension for first-time violations

## Testing

To verify the 24-hour process:

1. Create a test report
2. Check dashboard - should show 24 hours remaining
3. Wait or manually adjust timestamps for testing
4. Verify alerts appear for urgent/overdue reports
5. Resolve report and verify actions are tracked
