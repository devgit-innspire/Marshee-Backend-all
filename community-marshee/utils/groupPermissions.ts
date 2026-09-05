import { ICommunityGroup, CommunityGroupMemberRole } from "../models/communityGroup";
import mongoose from "mongoose";

export type GroupRole = Exclude<CommunityGroupMemberRole, "user"> | "member";

export type GroupPermission =
  | "delete_posts"
  | "pin_posts"
  | "pin_messages"
  | "remove_members"
  | "flag_post"
  | "suspend_user"
  | "change_member_role";

// Internal: normalize legacy roles and ensure we always work with the extended set.
export function normalizeRole(role: CommunityGroupMemberRole | null | undefined): GroupRole | null {
  if (!role) {
    return null;
  }

  if (role === "user") {
    return "member";
  }

  return role as GroupRole;
}

// Higher number => higher privilege
const ROLE_PRIORITY: Record<GroupRole, number> = {
  member: 0,
  expert: 1,
  moderator: 2,
  admin: 3,
};

const PERMISSIONS_BY_ROLE: Record<GroupRole, GroupPermission[]> = {
  admin: ["delete_posts", "pin_posts", "pin_messages", "remove_members", "flag_post", "suspend_user", "change_member_role"],
  moderator: ["delete_posts", "pin_posts", "pin_messages", "remove_members", "flag_post", "suspend_user"],
  expert: [],
  member: [],
};

export interface MembershipInfo {
  isMember: boolean;
  role: GroupRole | null;
}

export interface GroupPermissionOptions {
  /** When "admin", user is treated as group admin for all groups (platform admin). */
  platformRole?: string;
}

export function getMembershipInfo(
  group: ICommunityGroup,
  userId?: string | mongoose.Types.ObjectId | null,
  options?: GroupPermissionOptions
): MembershipInfo {
  if (!userId) {
    return { isMember: false, role: null };
  }

  if (options?.platformRole === "admin") {
    return { isMember: true, role: "admin" };
  }

  const userIdStr =
    typeof userId === "string" ? userId : (userId as mongoose.Types.ObjectId).toString();

  const member = group.members.find((m) => m.user.toString() === userIdStr);

  if (!member) {
    return { isMember: false, role: null };
  }

  const role = normalizeRole(member.role);

  return {
    isMember: true,
    role,
  };
}

export function hasPermission(
  group: ICommunityGroup,
  userId: string | mongoose.Types.ObjectId | null | undefined,
  permission: GroupPermission,
  options?: GroupPermissionOptions
): boolean {
  if (options?.platformRole === "admin") {
    return true;
  }

  const { isMember, role } = getMembershipInfo(group, userId);

  if (!isMember || !role) {
    return false;
  }

  const rolePermissions = PERMISSIONS_BY_ROLE[role] ?? [];
  return rolePermissions.includes(permission);
}

export function compareRolePriority(a: GroupRole | null, b: GroupRole | null): number {
  const aPriority = a ? ROLE_PRIORITY[a] : -1;
  const bPriority = b ? ROLE_PRIORITY[b] : -1;

  if (aPriority === bPriority) return 0;
  return aPriority > bPriority ? 1 : -1;
}

