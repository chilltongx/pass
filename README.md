# Pass Relay

Pass Relay 是一个自托管的私有文件传输工具，用来在自己的手机、电脑和服务器之间临时传输文字、链接、图片和文件。

我做这个项目的主要目的，是在传输个人文件时尽量不依赖微信、网盘、邮箱、聊天软件等第三方平台，把传输链路控制在自己管理的服务器上，减少文件内容被平台侧扫描、留存或监控的风险。

## 功能

- 发送文字、链接、验证码、临时笔记
- 上传图片或任意文件
- 在手机和电脑之间互相下载文件
- 页面生成二维码，方便手机快速打开
- 使用账号密码保护访问入口
- 文件和文字记录保存在服务器本地 `storage/` 目录
- 按日期范围清理旧文字和旧文件
- 文件管理视图支持按图片、文档、其他文件分类，并按日期分组

## 隐私与安全边界

这个项目的设计目标是“减少第三方平台参与”，不是承诺绝对匿名或绝对安全。

推荐的安全使用方式：

- 部署在自己控制的服务器上
- 必须配置 HTTPS，不要用明文 HTTP 在公网传输
- 设置足够长、随机的 `PASS_PASSWORD`
- 只开放 Nginx 的 `80` / `443` 端口，不要把 Node 服务端口 `6789` 直接暴露到公网
- 定期清理 `storage/` 中的旧文件

它可以减少第三方应用和网盘平台对文件传输过程的介入，但仍然需要信任：

- 你自己的服务器
- 服务器系统和 Nginx 配置
- 域名和 HTTPS 证书配置
- 访问设备本身的安全性

当前版本没有做端到端加密。文件会落盘保存在服务器的 `storage/` 目录中，所以不要把服务器账号、数据库密码、私钥等高敏感内容长期保存在里面。

## 本地启动

需要 Node.js 18 或更高版本。

```powershell
npm install
$env:PASS_PASSWORD="change-this-to-a-long-random-password"
npm start
```

默认监听端口是 `6789`：

```text
http://localhost:6789
```

默认用户名是 `pass`，密码来自 `PASS_PASSWORD`。也可以用 `PASS_USER` 自定义用户名。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `6789` | Node 服务监听端口 |
| `PUBLIC_URL` | 空 | 公网访问地址，用于生成二维码 |
| `PASS_USER` | `pass` | Basic Auth 用户名 |
| `PASS_PASSWORD` | 空 | Basic Auth 密码，公网部署必须设置 |
| `PASS_TOKEN` | 空 | `PASS_PASSWORD` 的兼容别名 |
| `PASS_ACCOUNTS` | 空 | 多账号配置，格式为 `user1:pass1,user2:pass2` |
| `PASS_REMEMBER_DAYS` | `30` | 登录成功后在同一浏览器保持登录的天数，设为 `0` 可关闭记住登录 |
| `MAX_UPLOAD_MB` | `500` | 单个上传请求的最大体积 |

示例 `.env` 内容：

```text
PORT=6789
PUBLIC_URL=https://pass.example.com
PASS_USER=pass
PASS_PASSWORD=change-this-to-a-long-random-password
PASS_REMEMBER_DAYS=30
MAX_UPLOAD_MB=500
```

## 阿里云 Ubuntu / Debian 部署

下面示例假设应用运行在服务器本机 `6789` 端口，公网只通过 Nginx 暴露 `80` 和 `443`。

1. 安装依赖并拉取代码。

```bash
cd /opt
git clone https://github.com/chilltongx/pass.git pass
cd /opt/pass
npm ci --omit=dev
```

2. 创建 systemd 服务。

```bash
sudo tee /etc/systemd/system/pass.service >/dev/null <<'EOF'
[Unit]
Description=Pass private relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pass
Environment=NODE_ENV=production
Environment=PORT=6789
Environment=PUBLIC_URL=https://pass.example.com
Environment=PASS_USER=pass
Environment=PASS_PASSWORD=change-this-to-a-long-random-password
Environment=PASS_REMEMBER_DAYS=30
Environment=MAX_UPLOAD_MB=500
ExecStart=/usr/bin/node /opt/pass/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pass
sudo systemctl status pass
```

3. 配置 Nginx 反向代理。

```nginx
server {
    listen 80;
    server_name pass.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pass.example.com;

    ssl_certificate /etc/letsencrypt/live/pass.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pass.example.com/privkey.pem;

    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:6789;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

4. 配置安全组。

只放行：

- `80/tcp`
- `443/tcp`

不要把 `6789/tcp` 直接开放到公网。

5. 申请 HTTPS 证书。

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d pass.example.com
sudo nginx -t
sudo systemctl reload nginx
```

也可以直接使用项目里的部署脚本：

```bash
sudo PUBLIC_URL=https://pass.example.com PASS_PASSWORD=change-this-to-a-long-random-password bash scripts/deploy-alicloud-ubuntu.sh
```

## 使用方式

电脑打开：

```text
https://pass.example.com
```

手机扫描页面上的二维码，输入同一组用户名和密码。之后两端看到的是同一份传输记录，可以上传、下载和删除内容。

页面右上角的“文件”按钮会打开文件管理器。文件管理器左侧按图片、文档、其他文件和日期组织目录，右侧像资源管理器一样列出文件，可以搜索、下载和删除。

页面右上角的“清理”按钮可以打开清理面板，选择开始日期和结束日期后，批量删除这个日期范围内的文字和文件。日期范围包含开始和结束当天，删除后不能恢复。

## 数据位置

上传文件和文字记录保存在：

```text
storage/
```

这个目录已经被 `.gitignore` 忽略，不会上传到 GitHub。如果服务器磁盘空间有限，建议定期删除旧文件。

## 项目定位

Pass Relay 更适合这些场景：

- 自己的手机和电脑之间临时传文件
- 不想通过第三方聊天软件发送私人文件
- 临时保存验证码、链接、笔记
- 在不同网络环境下快速中转文件

不建议把它当作长期网盘、多人协作平台或高敏感资料保险箱使用。
