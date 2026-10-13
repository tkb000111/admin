-- V3__nav_upgrade.sql
-- 导航升级：引入「功能」一级（顶级目录），现有脚手架功能整体归入「后台管理」。
-- 本文件可重复执行：INSERT IGNORE 对已存在的行跳过；UPDATE 带 parent_id = 0 守卫，已迁移过的库再跑一次不会重复改。
-- 路由地址、组件标识、按钮权限码全部不变，仅调整菜单树的层级归属。

-- 1. 顶级功能节点「后台管理」（id 900 与 V2 种子一致，图标 layers）
INSERT IGNORE INTO sys_menu (id, parent_id, menu_name, menu_type, icon, path, component, permission, sort, visible, status, create_by, update_by)
VALUES (900, 0, '后台管理', 'dir', 'layers', '', '', '', 1, 1, 1, 'system', 'system');

-- 2. 工作台与三个顶级目录改挂到「后台管理」之下（守卫：仅当它们仍挂在顶级时才动）
UPDATE sys_menu SET parent_id = 900, sort = 1 WHERE id = 1   AND parent_id = 0;
UPDATE sys_menu SET parent_id = 900, sort = 2 WHERE id = 100 AND parent_id = 0;
UPDATE sys_menu SET parent_id = 900, sort = 3 WHERE id = 200 AND parent_id = 0;
UPDATE sys_menu SET parent_id = 900, sort = 4 WHERE id = 300 AND parent_id = 0;

-- 3. 授权：超级管理员角色补上「后台管理」节点
INSERT IGNORE INTO sys_role_menu (role_id, menu_id)
SELECT 1, 900 WHERE NOT EXISTS (SELECT 1 FROM sys_role_menu WHERE role_id = 1 AND menu_id = 900);
