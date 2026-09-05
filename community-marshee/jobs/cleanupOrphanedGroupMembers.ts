import mongoose from "mongoose";
import CommunityGroup from "../models/communityGroup";
import User from "../models/User";

export interface CleanupOrphanedMembersResult {
  success: boolean;
  groupsProcessed: number;
  groupsUpdated: number;
  totalMembersRemoved: number;
  error?: string;
}

/**
 * Removes from each CommunityGroup's members array any entry whose user
 * no longer exists in the User collection (e.g. deleted users).
 */
export async function cleanupOrphanedGroupMembers(): Promise<CleanupOrphanedMembersResult> {
  const result: CleanupOrphanedMembersResult = {
    success: false,
    groupsProcessed: 0,
    groupsUpdated: 0,
    totalMembersRemoved: 0,
  };

  try {
    const groups = await CommunityGroup.find({})
      .select("_id members")
      .lean();

    result.groupsProcessed = groups.length;

    const allUserIds = new Set<string>();
    for (const g of groups) {
      const members = (g as any).members ?? [];
      for (const m of members) {
        if (m?.user) {
          allUserIds.add(
            typeof m.user === "object" && m.user._id
              ? m.user._id.toString()
              : m.user.toString()
          );
        }
      }
    }

    if (allUserIds.size === 0) {
      result.success = true;
      return result;
    }

    const existingUsers = await User.find({
      _id: { $in: Array.from(allUserIds).map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("_id")
      .lean();

    const existingIdSet = new Set(existingUsers.map((u) => u._id.toString()));

    const bulkOps: Array<{
      updateOne: {
        filter: { _id: unknown };
        update: { $set: { members: Array<{ user: unknown; role: string; joinedAt: Date }> } };
      };
    }> = [];

    for (const g of groups) {
      const members = (g as any).members ?? [];
      const validMembers = members.filter((m: any) => {
        if (!m?.user) return false;
        const uid =
          typeof m.user === "object" && m.user._id
            ? m.user._id.toString()
            : m.user.toString();
        return existingIdSet.has(uid);
      });

      const removed = members.length - validMembers.length;
      if (removed > 0) {
        result.totalMembersRemoved += removed;
        result.groupsUpdated += 1;
        bulkOps.push({
          updateOne: {
            filter: { _id: g._id },
            update: { $set: { members: validMembers } },
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await CommunityGroup.collection.bulkWrite(
        bulkOps as Parameters<typeof CommunityGroup.collection.bulkWrite>[0]
      );
    }

    result.success = true;
    return result;
  } catch (err: any) {
    result.error = err?.message ?? String(err);
    return result;
  }
}
