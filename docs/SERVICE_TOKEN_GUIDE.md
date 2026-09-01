# Service Token 与用户资料查询

Service Token 用于内部业务服务访问 CatsCo 账号中心。它不是用户 JWT，也不代表某个用户；业务服务应只在服务端保存它，并使用它读取用户资料或校验用户登录状态。

本文档适用于需要通过 `uid` 查询 CatsCo 用户资料的内部服务。

## 接口概览

账号中心提供两个相关接口：

| 接口 | 用途 | 认证 |
| --- | --- | --- |
| `POST /api/account/introspect` | 校验用户 JWT 是否有效，并返回用户资料 | `Authorization: Service <service_token>` |
| `GET /api/account/users/{uid}` | 按 UID 查询用户基础资料 | `Authorization: Service <service_token>` |

当前项目没有匿名用户表查询接口。`GET /api/users/search` 只返回当前用户可见的搜索结果，`GET /api/me` 只返回当前登录用户自己的资料。

## 创建 Service Token

### 使用本地账号后台

生产环境默认 API 端口绑定在服务器本机的 `26061`，公网 Nginx 不转发 `/local` 路径。先创建 SSH 隧道：

```bash
ssh -N -L 26061:127.0.0.1:26061 <server-alias>
```

然后在本机浏览器打开：

```text
http://127.0.0.1:26061/local/account-admin
```

进入 `Service Token` 区域，填写：

- 服务标识：使用稳定、唯一的 slug，例如 `route-reader`。
- 显示名称：使用便于识别的名称，例如 `Route user reader`。
- 权限范围：至少勾选 `account.users.read`。

提交后，页面会显示一次明文 Token。立即将它保存到业务服务的 Secret Manager 或服务端环境变量中。数据库只保存 Token 的哈希和前缀，之后无法恢复明文。

同一个服务标识再次提交会轮换 Token，并使旧 Token 失效。Token 泄露或遗失时，使用相同 slug 重新创建即可完成轮换。

### 使用本地管理接口

账号后台也提供本机管理接口。该接口不接受用户 JWT，而是根据请求来源限制为本机或私网地址：

```bash
curl -sS -X POST http://127.0.0.1:26061/local/account-admin/services \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "route-reader",
    "name": "Route user reader",
    "scopes": ["account.users.read"]
  }'
```

成功响应包含一次性的 `token` 字段：

```json
{
  "ok": true,
  "service": {
    "id": 1,
    "slug": "route-reader",
    "name": "Route user reader",
    "token_prefix": "cats_svc_xxxxx",
    "scopes": ["account.users.read"],
    "state": 0
  },
  "token": "cats_svc_<secret>"
}
```

如果服务直接监听 `:6061`，或部署使用其他端口，请将示例中的 `26061` 换成实际 HTTP 端口。

## 环境变量预置

也可以通过 `OC_ACCOUNT_SERVICE_TOKENS` 预置 Service Token：

```env
OC_ACCOUNT_SERVICE_TOKENS=route-reader=<plain-token>
```

生产环境更适合保存 SHA-256 摘要：

```env
OC_ACCOUNT_SERVICE_TOKENS=route-reader=sha256:<64-char-lowercase-hex>
```

多个 Token 可以用逗号、分号或换行分隔：

```env
OC_ACCOUNT_SERVICE_TOKENS=route-reader=<token-a>;ops-tool=<token-b>
```

环境变量 Token 没有单独配置的 scope。为了兼容旧部署，未配置 scope 的 Token 可以访问当前账号中心接口。需要细粒度权限时，优先使用本地后台创建的数据库 Token。

## 查询用户资料

业务服务调用用户资料接口时，使用 `Service` 认证方案，而不是 `Bearer`：

```bash
SERVICE_TOKEN='cats_svc_<secret>'
ACCOUNT_CENTER_URL='https://app.catsco.cc'
UID=123

curl -sS "$ACCOUNT_CENTER_URL/api/account/users/$UID" \
  -H "Authorization: Service $SERVICE_TOKEN" \
  -H 'Accept: application/json'
```

成功响应示例：

```json
{
  "uid": 123,
  "username": "alice",
  "email": "alice@example.com",
  "display_name": "Alice",
  "avatar_url": "/uploads/avatar.png",
  "account_type": "human",
  "state": 0,
  "created_at": "2026-05-01T08:00:00Z"
}
```

接口只返回账号中心定义的基础资料，不返回 `pass_hash`、Service Token 哈希或其他认证机密。`state` 为 `0` 表示账号正常；业务服务仍应根据自己的角色、套餐和权限模型做业务授权。

## 校验用户 JWT

如果业务服务收到的是用户 JWT，应先调用 introspection 接口：

```bash
USER_JWT='<user-jwt>'

curl -sS -X POST "$ACCOUNT_CENTER_URL/api/account/introspect" \
  -H "Authorization: Service $SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$USER_JWT\"}"
```

有效用户返回 `active: true` 和 `user`。JWT 过期、无效或账号已禁用时返回 `active: false`；业务服务不应只根据 JWT 解码结果放行请求。

## 路由表场景

当路由记录包含 `actor_uid`、`canonical_uid` 或 `agent_uid` 时，业务服务可以按以下顺序处理：

1. 先通过已有的受保护路由/绑定接口取得目标 UID。
2. 对需要展示的 UID 调用 `GET /api/account/users/{uid}`。
3. 按 `account_type` 和 `state` 过滤结果，再应用业务自己的权限判断。

不要把 `channel_user_id`、Service Token 或完整数据库行直接返回给浏览器。`channel_user_id` 属于外部渠道身份，不能替代 CatsCo 的 `uid`。

## 错误排查

| HTTP 状态 | 常见原因 | 处理方式 |
| --- | --- | --- |
| `401` | 缺少 `Authorization: Service ...`，Token 错误或已轮换 | 检查服务端 Secret，必要时重新轮换 Token |
| `403` | Token 配置了 scope，但没有 `account.users.read` 或 `account.introspect` | 更新 scope，或使用未限制 scope 的兼容 Token |
| `404` | UID 不存在 | 确认 UID 来源和数据环境 |
| `503` | 账号中心没有配置任何 Service Token 验证器 | 检查 `OC_ACCOUNT_SERVICE_TOKENS` 或数据库 Service Token 配置 |

## 安全要求

- Service Token 只能放在服务端环境变量、Secret Manager 或 CI/CD Secret 中。
- 不要把 Service Token 放进浏览器、移动端、桌面客户端、日志或公开仓库。
- 不要通过 query string 传递 Service Token。
- 业务服务应使用 HTTPS 调用公网账号中心，并限制 Token 的使用范围。
- Token 泄露时，使用相同 slug 重新创建并同步更新业务服务配置。
- 生产环境不要把 `/local/account-admin` 暴露到公网；账号后台应通过 SSH 隧道访问。

更多账号中心行为和接入约束参见 [ACCOUNT_CENTER_AUTH.md](ACCOUNT_CENTER_AUTH.md)。
