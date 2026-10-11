package com.scaffold.admin.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.server.ResponseStatusException;

/**
 * 单端口部署下的前端路由回退。
 *
 * 前端用 createWebHistory（history 模式），刷新子页面（如 /system/users）时
 * 后端并没有对应的接口，若不回退会直接 404。这里把「非 /api、且不带扩展名」
 * 的路径统一转发到 index.html，交给前端路由接管。
 *
 * 带扩展名的路径（.js / .css / .png 等）由 Spring 的静态资源处理，不会被这里匹配。
 */
@Controller
public class SpaFallbackController {

    @GetMapping(value = {"/**/{path:[^\\.]*}"})
    public String forward(HttpServletRequest request) {
        String uri = request.getRequestURI();
        // 接口路径不走回退，保持原本的 404 语义
        if (uri != null && uri.startsWith("/api")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Not Found");
        }
        return "forward:/index.html";
    }
}
