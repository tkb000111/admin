-- V4__manual_menu.sql
-- 新增「使用手册」菜单：权限鱼骨手册页（component manual/index，图标 bookOpen）。
-- 本文件可重复执行：INSERT IGNORE 对已存在的行跳过；角色授权同样幂等。
-- 页面本身无按钮操作，permission 留空；普通角色可在角色管理里按需勾选。

-- 1. 「使用手册」页面菜单：挂在顶级功能「后台管理」（id 900）下，排在最前
INSERT IGNORE INTO sys_menu (id, parent_id, menu_name, menu_type, icon, path, component, permission, sort, visible, status, create_by, update_by)
VALUES (950, 900, '使用手册', 'menu', 'bookOpen', '/manual', 'manual/index', '', 0, 1, 1, 'system', 'system');

-- 2. 授权：超级管理员角色补上该节点
INSERT IGNORE INTO sys_role_menu (role_id, menu_id)
SELECT 1, 950 WHERE NOT EXISTS (SELECT 1 FROM sys_role_menu WHERE role_id = 1 AND menu_id = 950);
