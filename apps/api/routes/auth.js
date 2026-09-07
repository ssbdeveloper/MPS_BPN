const express = require("express");
const router = express.Router();
const controller = require("../controllers/authController");

router.post("/login", controller.login);
router.post("/change-password", controller.changePassword);
router.get("/users", controller.listUsers);
router.post("/users", controller.createUser);
router.put("/users/:id", controller.updateUser);
router.delete("/users/:id", controller.deleteUser);

// RBAC — per-user permission overrides
router.get("/me/permissions", controller.getMyPermissions);
router.get("/users/:id/permissions", controller.getUserPermissions);
router.put("/users/:id/permissions", controller.updateUserPermissions);

// RBAC — role packages (Manage Users). Admin-only, sama seperti endpoint users di atas.
const requireAdmin = require("../rbac/requireAdmin");
const rbac = require("../controllers/rbacController");
router.get("/roles", requireAdmin, rbac.listRoles);
router.post("/roles", requireAdmin, rbac.createRole);
router.put("/roles/:role_key", requireAdmin, rbac.updateRole);
router.delete("/roles/:role_key", requireAdmin, rbac.deleteRole);
router.put("/users/:id/roles", requireAdmin, rbac.updateUserRoles);

module.exports = router;
