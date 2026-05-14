# Pass Relay

一个私有文件中继。手机和电脑只要都能访问你的阿里云服务器，就可以在校园网、公共 Wi-Fi、不同运营商网络之间互传文字、图片和文件。

## 本地启动

```powershell
npm install
$env:PASS_PASSWORD="改成你的强口令"
npm start
```

默认监听 `6789`：

```text
http://localhost:6789
```

用户名默认是 `pass`，密码来自 `PASS_PASSWORD`。也可以用 `PASS_USER` 自定义用户名。

## 阿里云部署

下面以 Ubuntu / Debian 系服务器为例，应用跑在本机 `6789`，公网只开放 Nginx 的 `80` 和 `443`。

1. 上传代码并安装 Node.js 18 或更新版本。

```bash
cd /opt
git clone <你的仓库地址> pass
cd /opt/pass
npm ci
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
Environment=PASS_PASSWORD=请改成很长的随机口令
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

4. 阿里云安全组放行：

- `80/tcp`
- `443/tcp`
- 不要把 `6789/tcp` 暴露到公网

5. 申请 HTTPS 证书。

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d pass.example.com
sudo nginx -t
sudo systemctl reload nginx
```

## 使用方式

电脑打开：

```text
https://pass.example.com
```

手机扫码页面上的二维码，输入同一个用户名和口令。之后两端看到的是同一个传输记录：

- 发送文字、链接、验证码、笔记
- 上传图片或任意文件
- 下载文件
- 删除传输记录

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `6789` | Node 服务监听端口 |
| `PUBLIC_URL` | 空 | 公网访问地址，用来生成二维码 |
| `PASS_USER` | `pass` | Basic Auth 用户名 |
| `PASS_PASSWORD` | 空 | Basic Auth 密码，公网部署必须设置 |
| `PASS_TOKEN` | 空 | `PASS_PASSWORD` 的兼容别名 |
| `MAX_UPLOAD_MB` | `500` | 单个上传请求最大体积 |

## 数据位置

上传文件和文字记录保存在：

```text
storage/
```

这个目录已被 `.gitignore` 忽略。服务器磁盘小的话，记得定期清理旧文件。
