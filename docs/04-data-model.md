# 04. 数据模型与业务状态设计

## 1. 数据建模原则

- 主键建议使用 UUID；业务编码（SKU、PI 编号、权限码、字典 code）使用独立唯一键。
- 所有业务表至少具备 `created_at`、`updated_at`；需要审计/软删除的实体另加对应字段。
- 时间戳统一存 UTC，API 输出 ISO 8601；界面按用户/后台配置时区显示。
- 产品、品类、菜单、字典标签等可翻译字段采用 `*_translations` 子表，以 `entity_id + locale` 唯一约束支持未来新增语言。
- 产品价格使用 PostgreSQL `NUMERIC` 与服务端 Decimal；禁止 float/double 做金额计算。
- 对高频检索字段建索引；对电话搜索使用规范化号码列，不只搜索格式化显示字符串。

## 2. 核心表（逻辑模型）

| 领域 | 表/实体 | 关键字段与约束 |
|---|---|---|
| 后台用户 | `admin_users` | username 唯一、password_hash、status、last_login_at、must_change_password |
| RBAC | `roles`、`permissions`、`user_roles`、`role_permissions` | code 唯一；多对多；超级管理员保护 |
| 菜单 | `menus`、`menu_translations` | parent_id、route、permission_code、sort_order、enabled |
| 字典 | `dictionary_types`、`dictionary_items`、`dictionary_item_translations` | type_code + item_code 唯一；system_locked |
| 配置 | `global_settings` | key 唯一、value JSONB、is_public、is_secret、updated_by |
| 品类 | `categories`、`category_translations` | parent_id 自关联、slug、code、sort_order、enabled；递归树 |
| 商品 | `products`、`product_translations` | sku 唯一、price_cny NUMERIC、lifecycle_status、publish_status、is_new、is_featured |
| 图片 | `product_images` / `file_assets` | storage_key、mime_type、size_bytes、sha256、width、height、sort_order、alt text |
| 标签 | `tags`、`tag_translations`、`product_tags` | tag code 唯一，多对多 |
| 广告 | `ads`、`ad_translations` | placement、desktop/mobile asset、target_url、active_from/to、enabled |
| 模板 | `quote_templates` | template_type、storage_key、version、field_mapping JSONB、status |
| 导出 | `quote_export_jobs` | requester、template_version、category/filter snapshot、status、file_key、expires_at、error_code |
| 任务清理 | `file_deletion_jobs` / `outbox_events` | 重试次数、下次重试、错误码，保障对象存储与 DB 一致 |
| PI | `pi_documents`、`pi_items`、`pi_revisions` | pi_no 唯一、buyer/seller snapshots、currency、terms、Decimal 金额、revision_no |
| 客户 | `customers` | phone_e164 唯一、country_code、display_name、created_at |
| 询盘 | `inquiry_activities` | customer_id、salesperson_name/phone、occurred_at、note、source、product_skus snapshot |
| 访问统计 | `visitor_sessions`、`page_views`、`country_daily_aggregates` | anon_session_hash、country_code、last_seen_at、path、event_time；不默认保存原始 IP |
| 审计 | `audit_logs` | actor_id、action、entity_type/id、request_id、metadata（脱敏） |

## 3. 商品状态应拆分

不要把“可用、预售、新品、草稿、停产”混在同一个状态字段：

- `lifecycle_status`: `available` / `preorder` / `discontinued`。
- `publish_status`: `draft` / `published` / `unpublished`。
- `is_new`: boolean。
- `is_featured`: boolean。

公共展示默认条件：`publish_status = published AND lifecycle_status <> discontinued`。预售商品可以公开但必须展示英文 `Pre-order` 标签。后台可以在生命周期字典中维护标签翻译，但核心 code 不允许随意改名或删除。

## 4. 品类树规则

- `categories.parent_id` 指向同表；禁止环形引用。
- 读取后代节点使用 PostgreSQL recursive CTE 或通过闭包表/物化路径优化；第一版优先递归 CTE 并对 parent_id 建索引。
- 前台选择某品类默认搜索此品类及所有后代的产品；当产品挂在父级节点时，也应在该父级品类列表显示。
- 品类路径移动要在事务内校验不是移动到自身后代；改变 slug 时考虑旧 URL redirect/canonical。
- 删除策略：有子类或商品绑定时禁止直接硬删除，改为停用或要求先迁移关联。

## 5. 客户重复规则

- 将电话清洗成 E.164 规范形式后存 `phone_e164`；有国家码时可解析，缺少国家码且无法确认时要求用户选择国家，不根据 IP 猜电话号码国家。
- 同一个客户电话号码只保留一个 `customers` 主档；每次来询盘建立新的 `inquiry_activities` 行，避免“去重后丢失重复跟进”的问题。
- 电话唯一约束是最终并发保护；业务流程中先查重并展示历史，再由数据库唯一约束兜底。

## 6. 产品价格保护

- 公共查询必须专门定义 `PublicProductCardDTO` / `PublicProductDetailDTO`，字段白名单只含 SKU、英文名称/描述、尺寸、重量、箱规、分类、图片、标签及 URL 等。
- 禁止通过 `select: { ...product }` 或序列化 ORM 记录后返回公共 API。
- CI 加公共 API 测试：响应 JSON 和 SSR HTML 搜索 `price`、`price_cny`、`unit_price` 等敏感字段/测试金额；静态扫描之外，还需人工查看页面源代码与 Network 响应。
