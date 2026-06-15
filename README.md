# SmokeDash

Self-hosted SmokePing dashboard with web-based node management. Monitor network latency from your servers to multiple ISP targets.

## Features

- Web-based node management — add/remove monitoring nodes via UI (no database required)
- Built-in SmokePing integration with auto-config generation
- Multi-ISP latency monitoring (China Telecom / Unicom / Mobile, 3 cities each)
- Deploy command generator for slave nodes with auto-generated strong secrets
- Admin password protection for management panel
- Stores data in local SQLite — zero external dependencies

## Quick Start

```bash
# Clone the repo
git clone https://github.com/asdjkm1234/SmokeDash.git
cd SmokeDash

# Start
docker compose up -d
```

- Dashboard: http://localhost:3000
- SmokePing CGI: http://localhost:8080/smokeping/smokeping.fcgi.dist

## Default Admin Password

On first launch, the admin password is `admin123`. Click **Manage** in the top-right corner, enter the password, and change it immediately.

## Adding Nodes

1. Click **Manage** → enter password → **Nodes** tab
2. Fill in Display Name (e.g., "Tokyo VPS") and Host (IP or domain)
3. Click **Add**
4. The same management panel generates Docker deploy commands under the **Deploy** tab

## Deploying Slave Nodes

For each node you add, run the generated `docker run` command on the corresponding server. The command auto-includes the master URL and shared secret.

The slave container image (`smokeping-slave`) sends ping results back to your master, which generates the latency charts.

## Architecture

```
SmokeDash Master                  Slave Nodes
┌─────────────┐                  ┌──────────┐
│  smokeping  │◄──── fping ─────│  Node 1  │
│  (Apache)   │                  └──────────┘
├─────────────┤                  ┌──────────┐
│  frontend   │                  │  Node 2  │
│  (Express)  │                  └──────────┘
└─────────────┘                  ┌──────────┐
│  SQLite     │                  │  Node N  │
└─────────────┘                  └──────────┘
```

## License

MIT License — see [LICENSE](LICENSE)
