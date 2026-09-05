import { Router } from 'express';
import { addMemberToGroup, checkMembershipStatus, createGroup, deleteGroup,
    getAllGroups, getAllUsers, getGroupById,
    getGroupMembers, getGroups, getUserGroups, joinGroup, leaveGroup,
    removeMember, updateGroup, updateMemberRole } from '../controllers/groupController';
import { auth } from '../middlewares/auth';

const router = Router();

/**
 * @openapi
 * /api/v1/groups/allGroups:
 *   get:
 *     summary: Get all groups
 *     tags: [Groups]
 *     responses:
 *       200:
 *         description: List of all groups
 */
router.get("/allGroups", auth, getAllGroups);

/**
 * @openapi
 * /api/v1/groups:
 *   get:
 *     summary: Get my groups
 *     tags: [Groups]
 *     responses:
 *       200:
 *         description: List of user's groups
 *   post:
 *     summary: Create a group
 *     tags: [Groups]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Group created
 */
router.get('/', auth, getGroups);
router.post('/', auth, createGroup);

/**
 * @openapi
 * /api/v1/groups/getAllUsers:
 *   get:
 *     summary: Get all users
 *     tags: [Groups]
 *     responses:
 *       200:
 *         description: List of all users
 */
router.get("/getAllUsers", auth, getAllUsers);

/**
 * @openapi
 * /api/v1/groups/my-groups:
 *   get:
 *     summary: Get groups I belong to
 *     tags: [Groups]
 *     responses:
 *       200:
 *         description: List of my groups
 */
router.get("/my-groups", auth, getUserGroups);

/**
 * @openapi
 * /api/v1/groups/{groupId}/members:
 *   get:
 *     summary: Get group members
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of members
 */
router.get("/:groupId/members", auth, getGroupMembers);

/**
 * @openapi
 * /api/v1/groups/{groupId}/membership-status:
 *   get:
 *     summary: Check membership status
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Membership status
 */
router.get("/:groupId/membership-status", auth, checkMembershipStatus);

/**
 * @openapi
 * /api/v1/groups/{groupId}/addMember:
 *   post:
 *     summary: Add member to group
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId: { type: string }
 *               role: { type: string }
 *     responses:
 *       200:
 *         description: Member added
 */
router.post("/:groupId/addMember", auth, addMemberToGroup);

/**
 * @openapi
 * /api/v1/groups/{groupId}/members/{userId}:
 *   patch:
 *     summary: Update member role
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role: { type: string }
 *     responses:
 *       200:
 *         description: Role updated
 *   delete:
 *     summary: Remove member from group
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Member removed
 */
router.patch("/:groupId/members/:userId", auth, updateMemberRole);
router.delete("/:groupId/members/:userId", auth, removeMember);

/**
 * @openapi
 * /api/v1/groups/{groupId}:
 *   get:
 *     summary: Get group by ID
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Group details
 *   patch:
 *     summary: Update group
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Group updated
 *   delete:
 *     summary: Delete group
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Group deleted
 */
router.patch('/:groupId', auth, updateGroup);
router.get("/:groupId", auth, getGroupById);
router.delete('/:groupId', auth, deleteGroup);

/**
 * @openapi
 * /api/v1/groups/join/{groupId}:
 *   post:
 *     summary: Join a group
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Joined group
 */
router.post("/join/:groupId", auth, joinGroup);

/**
 * @openapi
 * /api/v1/groups/leave/{groupId}:
 *   post:
 *     summary: Leave a group
 *     tags: [Groups]
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Left group
 */
router.post("/leave/:groupId", auth, leaveGroup);

export default router;
