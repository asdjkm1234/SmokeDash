# SmokeDash

基于 SmokePing 的网络延迟监控面板，支持 Web 界面管理监控节点。适合监测各 VPS 到国内三大运营商（电信/联通/移动）的延迟表现。

## 特性

- **Web 节点管理** — 通过网页直接添加/删除监控节点，无需手动编辑配置文件
- **自动配置生成** — 后端自动生成 SmokePing 配置文件并热重载
- **多线路测速** — 支持电信、联通、移动三大运营商，覆盖深圳、上海、北京三个城市
- **部署命令生成** — 自动生成 Docker 部署命令，每个节点拥有独立强随机密钥
- **管理密码保护** — 管理面板需要密码登录，防止未授权操作
- **零外部依赖** — 数据存储在本地 SQLite，无需 MySQL 等外部数据库

## 快速开始

```bash
git clone https://github.com/asdjkm1234/SmokeDash.git
cd SmokeDash
docker compose up -d
```

- 仪表盘：http://localhost:3000
- SmokePing CGI：http://localhost:8080/smokeping/smokeping.fcgi.dist

## 默认管理密码

首次启动后，管理密码为 `admin123`。点击右上角**管理**，输入密码登录后请立即修改。

## 添加监控节点

1. 点击右上角**管理** → 输入密码 → **节点管理**标签页
2. 输入节点名称（如"东京 VPS"）
3. 点击**添加**
4. 切换到**部署命令**标签页，即可看到每个节点的 `docker run` 部署命令

## 部署 Slave 节点

将生成的 `docker run` 命令在对应的节点服务器上执行即可。命令中已自动包含主服务器地址和独立密钥。

Slave 容器镜像通过 fping 将各节点到国内测速点的延迟数据上报给 Master，Master 生成延迟图表。

## 架构

```
SmokeDash Master                    Slave 节点
┌─────────────┐                   ┌──────────┐
│  smokeping  │◄───── fping ─────│  节点 1   │
│  (Apache)   │                   └──────────┘
├─────────────┤                   ┌──────────┐
│  frontend   │                   │  节点 2   │
│  (Express)  │                   └──────────┘
└─────────────┘                   ┌──────────┐
│  SQLite     │                   │  节点 N   │
└─────────────┘                   └──────────┘
```

## License

MIT License — 详见 [LICENSE](LICENSE)
