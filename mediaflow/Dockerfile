FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN wget -O /usr/local/bin/mediaflow-proxy-light \
    https://github.com/mhdzumair/mediaflow-proxy-light/releases/download/1.1.2/mediaflow-proxy-light-linux-x86_64 \
    && chmod +x /usr/local/bin/mediaflow-proxy-light

RUN mkdir -p /etc/mediaflow

COPY config.toml /etc/mediaflow/config.toml

RUN cat > /entrypoint.sh <<'SCRIPT'
#!/bin/bash
set -e
API_PASSWORD="${API_PASSWORD:-changeme}"
sed "s/api_password = \".*\"/api_password = \"$API_PASSWORD\"/" /etc/mediaflow/config.toml > /tmp/config.toml
export CONFIG_PATH="${CONFIG_PATH:-/tmp/config.toml}"
exec /usr/local/bin/mediaflow-proxy-light
SCRIPT
RUN chmod +x /entrypoint.sh

EXPOSE 8888

ENTRYPOINT ["/entrypoint.sh"]
