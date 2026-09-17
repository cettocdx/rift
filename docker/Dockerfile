FROM kalilinux/kali-rolling

LABEL org.opencontainers.image.title="RIFT Agent Sandbox"
LABEL org.opencontainers.image.description="AI Agent Penetration Testing Environment with Comprehensive Automated Tools"
LABEL org.opencontainers.image.source="https://github.com/rift-tech/rift"
LABEL org.opencontainers.image.vendor="RIFT"

# ============================================================================
# Environment Variables
# ============================================================================
ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/home/user
ENV GOPATH=/home/user/go
ENV GOCACHE=/home/user/go/.cache
ENV PATH=/home/user/.local/bin:/usr/local/go/bin:/home/user/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ============================================================================
# dpkg slimming — never install documentation, manpages, locales, etc.
# Applied before any apt install so every package layer is genuinely smaller
# (deleting these in a later layer would NOT reclaim build disk).
# ============================================================================
RUN { \
      echo 'path-exclude /usr/share/doc/*'; \
      echo 'path-include /usr/share/doc/*/copyright'; \
      echo 'path-exclude /usr/share/man/*'; \
      echo 'path-exclude /usr/share/groff/*'; \
      echo 'path-exclude /usr/share/info/*'; \
      echo 'path-exclude /usr/share/lintian/*'; \
      echo 'path-exclude /usr/share/locale/*'; \
    } > /etc/dpkg/dpkg.cfg.d/01_nodoc

# ============================================================================
# Base System Setup (use default Kali CDN mirror - auto-routes to healthy mirrors)
# ============================================================================
RUN apt-get update && \
    apt-get install -y kali-archive-keyring sudo && \
    apt-get update && \
    apt-get upgrade -y

# ============================================================================
# Core System Packages
# ============================================================================
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    # Essential utilities
    curl \
    wget \
    git \
    ca-certificates \
    gnupg2 \
    unzip \
    jq \
    tree \
    perl \
    sudo \
    # Build tools
    build-essential \
    gcc \
    g++ \
    make \
    cmake \
    pkg-config \
    binutils \
    # Python stack
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    python-is-python3 \
    libffi-dev \
    libxml2-dev \
    libxslt1-dev \
    zlib1g-dev \
    libglib2.0-dev \
    # Ruby stack
    ruby-full \
    ruby-dev \
    libnet-ssleay-perl \
    libio-socket-ssl-perl \
    libcrypt-ssleay-perl \
    libssl-dev \
    # Network utilities
    iputils-ping \
    dnsutils \
    iproute2 \
    net-tools \
    traceroute \
    netcat-traditional \
    tcpdump \
    # Search tools
    ripgrep \
    # Text editors
    vim \
    nano \
    less \
    # Network scanning & enumeration (from Kali repos - pre-compiled!)
    nmap \
    naabu \
    nikto \
    whatweb \
    wafw00f \
    # Web vulnerability scanners
    sqlmap \
    wapiti \
    wpscan \
    # DNS/subdomain enumeration
    subfinder \
    dnsrecon \
    dnsenum \
    # Web fuzzing & discovery
    ffuf \
    arjun \
    gobuster \
    dirsearch \
    # SMB/NetBIOS tools
    smbclient \
    smbmap \
    nbtscan \
    python3-impacket \
    enum4linux \
    # Active Directory/Windows tools (Linux-compatible)
    ldap-utils \
    crackmapexec \
    python3-ldap3 \
    python3-asn1crypto \
    python3-dnspython \
    python3-requests \
    python3-pyasn1 \
    # Mobile security tools
    adb \
    apktool \
    # Cloud security tools
    awscli \
    azure-cli \
    # API security tools
    wfuzz \
    burpsuite \
    # Network discovery
    hping3 \
    arp-scan \
    # Utilities
    socat \
    proxychains4 \
    seclists \
    hashid \
    libimage-exiftool-perl \
    cewl \
    # SSL/TLS testing
    testssl.sh \
    # Web crawling & recon
    gospider \
    nuclei \
    # Authentication/bruteforce
    hydra \
    # Programming languages
    golang \
    nodejs \
    npm \
    tmux \
    # Forensics
    binwalk \
    foremost \
    # Document conversion
    pandoc \
    poppler-utils \
    # Web application security scanner
    zaproxy \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# ============================================================================
# WhatWeb Ruby Library Symlink Fix
# ============================================================================
RUN set -eux; \
    if command -v whatweb >/dev/null 2>&1; then \
      mkdir -p /usr/bin/lib; \
      if ls /usr/lib/ruby/vendor_ruby/*.rb >/dev/null 2>&1; then \
        ln -sf /usr/lib/ruby/vendor_ruby/*.rb /usr/bin/lib/; \
      fi; \
    fi

# ============================================================================
# User Setup
# ============================================================================
RUN (id -u user >/dev/null 2>&1 || useradd --create-home --shell /bin/bash user) && \
    usermod -aG sudo user && \
    echo 'user ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers && \
    mkdir -p /home/user/upload /home/user/go && \
    chown -R user:user /home/user

WORKDIR /home/user

# Ensure Go bin paths are in PATH for login shells (su - user, bash -l)
RUN echo 'export PATH=/home/user/.local/bin:/usr/local/go/bin:/home/user/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}' \
    > /etc/profile.d/00-rift-path.sh && chmod 644 /etc/profile.d/00-rift-path.sh

# ============================================================================
# Python Packages for Document Generation & Security Tools
# ============================================================================
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    reportlab \
    python-docx \
    openpyxl \
    python-pptx \
    pandas \
    pypandoc \
    odfpy

# Additional security-focused Python packages
RUN pip3 install --break-system-packages --ignore-installed --no-compile requests aiohttp jinja2 httpx ratelimit pycryptodomex

# Active Directory Python tools
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    ldapdomaindump \
    adidnsdump \
    kerberoast \
    impacket \
    bloodhound

# ============================================================================
# Google Cloud CLI (provides `gcloud`) — installed from the official apt repo
# since `google-cloud-sdk` is not available in the Kali repositories.
# ============================================================================
RUN set -eux; \
    curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list && \
    apt-get update && apt-get install -y --no-install-recommends google-cloud-cli && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Mobile Security Python tools
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    frida-tools \
    objection \
    androguard

# Cloud Security Python tools
# Note: cloud-nuke (Go) and cloudsploit (Node) are not PyPI packages and are
# intentionally omitted here. ScoutSuite is the primary multi-cloud auditor.
# pacu and prowler are intentionally omitted: they bundle duplicate multi-cloud
# SDK stacks (aws/azure/gcp) that exceed the build disk budget and are already
# largely covered by ScoutSuite + the aws/az/gcloud CLIs.
RUN pip3 install --break-system-packages --ignore-installed --no-compile ScoutSuite

# API Security Python tools
# Note: swagger-codegen-cli (Java), graphql-path-enum (GitLab-only) and
# graphql-cop (GitHub-only) are not on PyPI and are omitted.
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    graphql-core

# Reporting & CVSS tools
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    cvss \
    jinja2

# Vulnerability Database tools
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    cve-searchsploit \
    mitreattack-python \
    requests

# Threat Intelligence tools
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    shodan \
    vt-py \
    python-abuseipdb

# Visual Recon tools
# Note: chromium + xvfb + EyeWitness (web screenshotting) are intentionally
# omitted — the headless browser stack (~1GB) exceeds the build disk budget.
# HTTP recon is still covered by httpx, whatweb, gospider, katana, etc.

# Payload Management tools
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    pwntools \
    pyinstaller

# Evidence Collection tools
RUN apt-get update && apt-get install -y \
    python3-tk \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Note: hashlib is part of the Python standard library; the PyPI "hashlib"
# package is a broken Python 2 backport and is omitted.
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
    tzdata

# ============================================================================
# Git-based Security Tools
# ============================================================================
RUN set -eux; \
    # JWT analysis tool
    git clone --depth 1 https://github.com/ticarpi/jwt_tool.git /opt/jwt_tool || true && \
    if [ -f /opt/jwt_tool/jwt_tool.py ]; then chmod +x /opt/jwt_tool/jwt_tool.py; fi && \
    # Git repository dumper
    git clone --depth 1 https://github.com/internetwache/GitTools.git /opt/gittools && \
    chmod +x /opt/gittools/Dumper/gitdumper.sh /opt/gittools/Extractor/extractor.sh && \
    ln -sf /opt/gittools/Dumper/gitdumper.sh /usr/local/bin/gitdumper && \
    ln -sf /opt/gittools/Extractor/extractor.sh /usr/local/bin/gitextractor && \
    # enum4linux-aux (enhanced enum4linux)
    git clone --depth 1 https://github.com/cddmp/enum4linux-ng.git /opt/enum4linux-ng || true && \
    if [ -f /opt/enum4linux-ng/enum4linux-ng.py ]; then ln -sf /opt/enum4linux-ng/enum4linux-ng.py /usr/local/bin/enum4linux-aux && chmod +x /usr/local/bin/enum4linux-aux; fi && \
    # MobSF (Mobile Security Framework)
    git clone --depth 1 https://github.com/MobSF/Mobile-Security-Framework-MobSF.git /opt/MobSF || true && \
    # drozer (Android security assessment framework)
    git clone --depth 1 https://github.com/WithSecureLabs/drozer.git /opt/drozer || true

# ============================================================================
# Binary Downloads (Platform-aware)
# ============================================================================
RUN set -eux; \
    # Secret scanning tool
    curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin && \
    # Vulnerability scanner for containers and filesystems
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin && \
    # httpx with proper architecture detection
    arch=$(uname -m); \
    if [ "$arch" = "x86_64" ]; then platform="linux_amd64"; \
    elif [ "$arch" = "aarch64" ] || [ "$arch" = "arm64" ]; then platform="linux_arm64"; \
    else platform="linux_amd64"; fi; \
    HTTPX_URL=$(curl -s https://api.github.com/repos/projectdiscovery/httpx/releases/latest \
      | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*' | cut -d '"' -f4 \
      | grep -E "${platform}[.]zip$" | head -n1); \
    echo "Fetching httpx: $HTTPX_URL"; \
    wget -qO /tmp/httpx.zip "$HTTPX_URL" && \
    mkdir -p /tmp/httpx_extracted && \
    unzip -q /tmp/httpx.zip -d /tmp/httpx_extracted || true; \
    HTTPX_BIN=$(find /tmp/httpx_extracted -type f -name httpx | head -n1); \
    if [ -n "$HTTPX_BIN" ]; then mv "$HTTPX_BIN" /usr/local/bin/httpx; chmod +x /usr/local/bin/httpx; fi; \
    rm -rf /tmp/httpx_extracted /tmp/httpx.zip

# ============================================================================
# Caido CLI — Web Security Proxy (free, headless, GraphQL API)
# ============================================================================
RUN set -eux; \
    arch=$(uname -m); \
    if [ "$arch" = "x86_64" ]; then CAIDO_ARCH="x86_64"; \
    elif [ "$arch" = "aarch64" ] || [ "$arch" = "arm64" ]; then CAIDO_ARCH="aarch64"; \
    else echo "Unsupported architecture: $arch" && exit 1; fi; \
    CAIDO_VERSION=$(curl -s https://api.github.com/repos/caido/caido/releases/latest \
      | grep '"tag_name"' | cut -d'"' -f4); \
    echo "Installing caido-cli ${CAIDO_VERSION} for ${CAIDO_ARCH}"; \
    wget -qO /tmp/caido-cli.tar.gz \
      "https://caido.download/releases/${CAIDO_VERSION}/caido-cli-${CAIDO_VERSION}-linux-${CAIDO_ARCH}.tar.gz" && \
    tar -xzf /tmp/caido-cli.tar.gz -C /tmp && \
    chmod +x /tmp/caido-cli && \
    mv /tmp/caido-cli /usr/local/bin/caido-cli && \
    rm /tmp/caido-cli.tar.gz && \
    mkdir -p /app/certs

# ============================================================================
# Create Wrapper Scripts for Python Tools
# ============================================================================
RUN set -eux; \
    # JWT Tool wrapper
    if [ -f /opt/jwt_tool/jwt_tool.py ]; then \
      { echo '#!/bin/bash'; echo 'python3 /opt/jwt_tool/jwt_tool.py "$@"'; } > /usr/local/bin/jwt-tool; \
      chmod +x /usr/local/bin/jwt-tool; \
    fi

# ============================================================================
# Go-based Security Tools (installed as prebuilt release binaries)
# ============================================================================
# These ProjectDiscovery tools are pulled as prebuilt release binaries instead
# of `go install`, because the Go module/build cache overflows the build disk.
# The `go` toolchain itself remains installed for runtime use.
RUN set -eux; \
    arch=$(uname -m); \
    if [ "$arch" = "x86_64" ]; then platform="linux_amd64"; \
    elif [ "$arch" = "aarch64" ] || [ "$arch" = "arm64" ]; then platform="linux_arm64"; \
    else platform="linux_amd64"; fi; \
    for spec in projectdiscovery/interactsh:interactsh-client projectdiscovery/katana:katana projectdiscovery/vulnx:vulnx; do \
      gh_repo=${spec%%:*}; bin=${spec##*:}; \
      url=$(curl -sL "https://api.github.com/repos/${gh_repo}/releases/latest" \
        | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*' | cut -d '"' -f4 \
        | grep "${bin}_" | grep -E "${platform}[.]zip$" | head -n1); \
      if [ -z "$url" ]; then echo "ERROR: no release asset for ${bin} (${platform})"; exit 1; fi; \
      echo "Fetching ${bin}: ${url}"; \
      wget -qO /tmp/pd.zip "$url"; \
      rm -rf /tmp/pd_x; mkdir -p /tmp/pd_x; \
      unzip -q /tmp/pd.zip -d /tmp/pd_x; \
      f=$(find /tmp/pd_x -type f -name "$bin" | head -n1); \
      if [ -z "$f" ]; then echo "ERROR: ${bin} not found in archive"; exit 1; fi; \
      mv "$f" /usr/local/bin/${bin}; chmod +x /usr/local/bin/${bin}; \
      rm -rf /tmp/pd_x /tmp/pd.zip; \
    done; \
    ln -sf /usr/local/bin/vulnx /usr/local/bin/cvemap

# ============================================================================
# Extended Arsenal — exploitation, cracking, recon, OSINT, AD/lateral
# Installed per-package with graceful skip so an occasional renamed/missing
# Kali package never fails the whole build. The agent can also install any of
# these at runtime (sudo apt-get install ...), so a skip is not fatal.
# ============================================================================
RUN set -eux; \
    apt-get update; \
    for pkg in \
      metasploit-framework \
      hashcat \
      john \
      hydra-gtk \
      masscan \
      amass \
      dalfox \
      theharvester \
      recon-ng \
      responder \
      exploitdb \
      feroxbuster \
      sherlock \
      seclists \
      wordlists \
      evil-winrm \
      netexec \
      certipy-ad \
      sslscan \
      dnsx \
      mapcidr; do \
      apt-get install -y --no-install-recommends "$pkg" || echo "WARN: skipped $pkg (not in repo)"; \
    done; \
    apt-get clean; rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# OSINT / username-email tools best installed from PyPI (graceful)
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
      holehe maigret || echo "WARN: some pip OSINT tools skipped"

# ============================================================================
# MAXIMAL ARSENAL EXPANSION
# "Give it every tool that fits." Each package is installed with a graceful
# skip so a single renamed/missing/oversized package never fails the whole
# build. Anything skipped here is still one `sudo apt-get install` / `pip` /
# `go install` away at runtime (full Kali + NOPASSWD sudo).
# ============================================================================

# --- Extended apt arsenal (web, sqli, dns, snmp/smtp, passwords, RE, net, db)
RUN set -eux; \
    apt-get update; \
    for pkg in \
      skipfish xsser dotdotpwn davtest cadaver padbuster uniscan joomscan \
      commix medusa ncrack crunch patator hash-identifier dmitry metagoofil \
      dirb sslyze ssh-audit onesixtyone snmpcheck snmp smtp-user-enum swaks \
      fierce dnstwist sublist3r fping \
      radare2 gdb ltrace strace yara upx-ucl patchelf checksec \
      default-mysql-client postgresql-client redis-tools \
      steghide stegseek sshuttle chisel \
      routersploit sslstrip mitmproxy bettercap \
      impacket-scripts finger rusers rwho; do \
      apt-get install -y --no-install-recommends "$pkg" || echo "WARN: skipped $pkg"; \
    done; \
    apt-get clean; rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# --- Go recon suite (tomnomnom + ProjectDiscovery gaps). Installed straight to
#     /usr/local/bin via GOBIN, then the whole Go cache is purged IN THE SAME
#     layer so the module/build cache never bloats the final image.
RUN set -eux; \
    export GOBIN=/usr/local/bin GOFLAGS=-buildvcs=false; \
    for mod in \
      github.com/tomnomnom/assetfinder@latest \
      github.com/tomnomnom/httprobe@latest \
      github.com/tomnomnom/waybackurls@latest \
      github.com/tomnomnom/gf@latest \
      github.com/tomnomnom/anew@latest \
      github.com/tomnomnom/unfurl@latest \
      github.com/tomnomnom/qsreplace@latest \
      github.com/tomnomnom/gron@latest \
      github.com/lc/gau/v2/cmd/gau@latest \
      github.com/hakluke/hakrawler@latest \
      github.com/sensepost/gowitness@latest \
      github.com/ropnop/kerbrute@latest \
      github.com/projectdiscovery/tlsx/cmd/tlsx@latest \
      github.com/projectdiscovery/asnmap/cmd/asnmap@latest \
      github.com/projectdiscovery/uncover/cmd/uncover@latest \
      github.com/projectdiscovery/shuffledns/cmd/shuffledns@latest \
      github.com/projectdiscovery/alterx/cmd/alterx@latest \
      github.com/hahwul/dalfox/v2@latest; do \
      go install "$mod" || echo "WARN: go install skipped $mod"; \
    done; \
    go clean -cache -modcache || true; \
    rm -rf /home/user/go/pkg /home/user/go/.cache /root/go /tmp/go-build*

# --- Extended pip arsenal (web/sqli, AD/lateral, forensics). Per-package loop
#     so a single unavailable/broken package never drops the whole batch.
RUN set -eux; \
    for p in droopescan mitm6 pywerview pypykatz lsassy spiderfoot \
             paramspider dnsgen volatility3 pacu prowler; do \
      pip3 install --break-system-packages --ignore-installed --no-compile "$p" \
        || echo "WARN: pip skipped $p"; \
    done

# --- Popular git-only tools with PATH wrappers
RUN set -eux; \
    clone() { git clone --depth 1 "$1" "$2" 2>/dev/null || echo "WARN: clone skipped $1"; }; \
    clone https://github.com/s0md3v/XSStrike.git         /opt/XSStrike; \
    clone https://github.com/GerbenJavado/LinkFinder.git /opt/LinkFinder; \
    clone https://github.com/m4ll0k/SecretFinder.git     /opt/SecretFinder; \
    clone https://github.com/s0md3v/Corsy.git            /opt/Corsy; \
    clone https://github.com/codingo/NoSQLMap.git        /opt/NoSQLMap; \
    clone https://github.com/aboul3la/Sublist3r.git      /opt/Sublist3r; \
    clone https://github.com/r0oth3x49/ghauri.git        /opt/ghauri; \
    if [ -f /opt/ghauri/setup.py ]; then \
      pip3 install --break-system-packages --ignore-installed --no-compile /opt/ghauri \
        || echo "WARN: ghauri install failed"; \
    fi; \
    clone https://github.com/devanshbatham/ParamSpider.git /opt/ParamSpider; \
    if [ -d /opt/ParamSpider ]; then \
      pip3 install --break-system-packages --ignore-installed --no-compile /opt/ParamSpider \
        || echo "WARN: paramspider install failed"; \
    fi; \
    clone https://github.com/smicallef/spiderfoot.git    /opt/spiderfoot; \
    if [ -f /opt/spiderfoot/requirements.txt ]; then \
      python3 -m venv --system-site-packages /opt/spiderfoot/.venv; \
      SFV=/opt/spiderfoot/.venv/bin; \
      grep -vi "^lxml" /opt/spiderfoot/requirements.txt > /tmp/sf-reqs.txt || cp /opt/spiderfoot/requirements.txt /tmp/sf-reqs.txt; \
      "$SFV/pip" install --no-cache-dir --prefer-binary --upgrade pip wheel lxml || true; \
      "$SFV/pip" install --no-cache-dir --prefer-binary -r /tmp/sf-reqs.txt || echo "WARN: spiderfoot deps skipped"; \
      rm -f /tmp/sf-reqs.txt; \
      { echo '#!/bin/bash'; echo 'exec /opt/spiderfoot/.venv/bin/python /opt/spiderfoot/sf.py "$@"'; } > /usr/local/bin/spiderfoot; \
      chmod +x /usr/local/bin/spiderfoot; \
      { echo '#!/bin/bash'; echo 'exec /opt/spiderfoot/.venv/bin/python /opt/spiderfoot/sfcli.py "$@"'; } > /usr/local/bin/sfcli; \
      chmod +x /usr/local/bin/sfcli; \
    fi; \
    for spec in \
      "XSStrike/xsstrike.py:xsstrike" \
      "LinkFinder/linkfinder.py:linkfinder" \
      "SecretFinder/SecretFinder.py:secretfinder" \
      "Corsy/corsy.py:corsy" \
      "NoSQLMap/nosqlmap.py:nosqlmap" \
      "Sublist3r/sublist3r.py:sublist3r-git"; do \
      src="/opt/${spec%%:*}"; name="${spec##*:}"; \
      if [ -f "$src" ]; then \
        { echo '#!/bin/bash'; echo "python3 $src \"\$@\""; } > "/usr/local/bin/$name"; \
        chmod +x "/usr/local/bin/$name"; \
      fi; \
    done

# ============================================================================
# Cloudflare origin-discovery toolkit (authorized pentest recon)
#   censys + shodan SDK/CLI, CloudFlair (Censys-based origin finder), and a
#   purpose-built `cf-origin` script (TLS cert -> Censys/Shodan/SecurityTrails/
#   crt.sh -> Host-header validation). API keys arrive via the sandbox env at
#   runtime (see run-terminal-cmd RECON_ENV_KEYS); nothing is baked in.
# ============================================================================
RUN pip3 install --break-system-packages --ignore-installed --no-compile \
      censys shodan dnspython || echo "WARN: censys/shodan pip skipped"
RUN set -eux; \
    git clone --depth 1 https://github.com/christophetd/CloudFlair.git /opt/CloudFlair 2>/dev/null || echo "WARN: CloudFlair clone skipped"; \
    if [ -f /opt/CloudFlair/requirements.txt ]; then \
      pip3 install --break-system-packages --ignore-installed --no-compile -r /opt/CloudFlair/requirements.txt || echo "WARN: CloudFlair deps skipped"; \
    fi; \
    if [ -f /opt/CloudFlair/cloudflair.py ]; then \
      { echo '#!/bin/bash'; echo 'python3 /opt/CloudFlair/cloudflair.py "$@"'; } > /usr/local/bin/cloudflair; \
      chmod +x /usr/local/bin/cloudflair; \
    fi
# cf-origin — base64-embedded so E2B's RUN flattening can't mangle the source.
RUN set -eux; \
    echo 'IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwoiIiIKY2Ytb3JpZ2luIDxkb21haW4+IOKAlCBodW50IHRoZSByZWFsIG9yaWdpbiBzZXJ2ZXIgYmVoaW5kIENsb3VkZmxhcmUgKGFuZCBzaW1pbGFyCmVkZ2UvV0FGIHByb3hpZXMpIGZvciBBVVRIT1JJWkVEIHBlbmV0cmF0aW9uIHRlc3Rpbmcgb25seS4KClBpcGVsaW5lOgogIDEuIFJlc29sdmUgdGhlIGRvbWFpbiwgZmxhZyB3aGV0aGVyIGV2ZXJ5IEEgcmVjb3JkIGlzIGEgQ2xvdWRmbGFyZSBJUC4KICAyLiBQdWxsIHRoZSBvcmlnaW4gVExTIGNlcnRpZmljYXRlIChTQU5zICsgU0hBLTI1NiBmaW5nZXJwcmludCkgZnJvbSB0aGUgZWRnZS4KICAzLiBBc2sgZXh0ZXJuYWwgaW50ZWwgd2hvIGVsc2Ugc2VydmVzIHRoYXQgY2VydCAvIHRob3NlIGhvc3RuYW1lcyBvbiBhIHJhdyBJUDoKICAgICAgIC0gQ2Vuc3lzICAgKENFTlNZU19BUElfSUQgKyBDRU5TWVNfQVBJX1NFQ1JFVCkKICAgICAgIC0gU2hvZGFuICAgKFNIT0RBTl9BUElfS0VZKQogICAgICAgLSBTZWN1cml0eVRyYWlscyBoaXN0b3JpY2FsIEEgcmVjb3JkcyAoU0VDVVJJVFlUUkFJTFNfQVBJX0tFWSkKICAgICAgIC0gY3J0LnNoIGNlcnRpZmljYXRlLXRyYW5zcGFyZW5jeSAobm8ga2V5LCBmcmVlKQogIDQuIFZhbGlkYXRlIGVhY2ggbm9uLUNsb3VkZmxhcmUgY2FuZGlkYXRlIElQOiBmZXRjaCBpdCBkaXJlY3RseSB3aXRoIHRoZSByZWFsCiAgICAgSG9zdCBoZWFkZXIgYW5kIGNvbXBhcmUgdGhlIHJlc3BvbnNlIHRvIHRoZSBlZGdlIGJhc2VsaW5lLiBBIGNsb3NlIG1hdGNoCiAgICAgbWVhbnMgdGhlIG9yaWdpbiBpcyBleHBvc2VkLgoKS2V5cyBhcmUgcmVhZCBmcm9tIHRoZSBlbnZpcm9ubWVudCAoaW5qZWN0ZWQgYnkgdGhlIFJJRlQgc2FuZGJveCkuIE1pc3Npbmcga2V5cwpqdXN0IHNraXAgdGhhdCBzb3VyY2UuIE5vdGhpbmcgaGVyZSBpcyBkZXN0cnVjdGl2ZTsgaXQgb25seSByZWFkcyBwdWJsaWMgaW50ZWwKYW5kIGlzc3VlcyBvcmRpbmFyeSBIVFRQIEdFVHMuCiIiIgppbXBvcnQgb3MsIHN5cywgc3NsLCBqc29uLCBzb2NrZXQsIGhhc2hsaWIsIGlwYWRkcmVzcywgdXJsbGliLnJlcXVlc3QsIHVybGxpYi5lcnJvcgoKVElNRU9VVCA9IDgKCkNGX1JBTkdFUyA9IFsKICAgICIxNzMuMjQ1LjQ4LjAvMjAiLCAiMTAzLjIxLjI0NC4wLzIyIiwgIjEwMy4yMi4yMDAuMC8yMiIsICIxMDMuMzEuNC4wLzIyIiwKICAgICIxNDEuMTAxLjY0LjAvMTgiLCAiMTA4LjE2Mi4xOTIuMC8xOCIsICIxOTAuOTMuMjQwLjAvMjAiLCAiMTg4LjExNC45Ni4wLzIwIiwKICAgICIxOTcuMjM0LjI0MC4wLzIyIiwgIjE5OC40MS4xMjguMC8xNyIsICIxNjIuMTU4LjAuMC8xNSIsICIxMDQuMTYuMC4wLzEzIiwKICAgICIxMDQuMjQuMC4wLzE0IiwgIjE3Mi42NC4wLjAvMTMiLCAiMTMxLjAuNzIuMC8yMiIsCl0KX0NGX05FVFMgPSBbaXBhZGRyZXNzLmlwX25ldHdvcmsoYykgZm9yIGMgaW4gQ0ZfUkFOR0VTXQoKZGVmIGlzX2NmKGlwKToKICAgIHRyeToKICAgICAgICBhID0gaXBhZGRyZXNzLmlwX2FkZHJlc3MoaXApCiAgICBleGNlcHQgVmFsdWVFcnJvcjoKICAgICAgICByZXR1cm4gRmFsc2UKICAgIHJldHVybiBhbnkoYSBpbiBuIGZvciBuIGluIF9DRl9ORVRTKQoKZGVmIGModHh0LCBjb2RlKToKICAgIHJldHVybiBmIlwwMzNbe2NvZGV9bXt0eHR9XDAzM1swbSIKCmRlZiByZXNvbHZlKGhvc3QpOgogICAgdHJ5OgogICAgICAgIHJldHVybiBzb3J0ZWQoe3JbNF1bMF0gZm9yIHIgaW4gc29ja2V0LmdldGFkZHJpbmZvKGhvc3QsIE5vbmUsIHNvY2tldC5BRl9JTkVULCBzb2NrZXQuU09DS19TVFJFQU0pfSkKICAgIGV4Y2VwdCBPU0Vycm9yOgogICAgICAgIHJldHVybiBbXQoKZGVmIGdldF9jZXJ0KGhvc3QpOgogICAgY3R4ID0gc3NsLmNyZWF0ZV9kZWZhdWx0X2NvbnRleHQoKQogICAgY3R4LmNoZWNrX2hvc3RuYW1lID0gRmFsc2UKICAgIGN0eC52ZXJpZnlfbW9kZSA9IHNzbC5DRVJUX05PTkUKICAgIHRyeToKICAgICAgICB3aXRoIHNvY2tldC5jcmVhdGVfY29ubmVjdGlvbigoaG9zdCwgNDQzKSwgdGltZW91dD1USU1FT1VUKSBhcyBzb2NrOgogICAgICAgICAgICB3aXRoIGN0eC53cmFwX3NvY2tldChzb2NrLCBzZXJ2ZXJfaG9zdG5hbWU9aG9zdCkgYXMgc3M6CiAgICAgICAgICAgICAgICBkZXIgPSBzcy5nZXRwZWVyY2VydChiaW5hcnlfZm9ybT1UcnVlKQogICAgICAgICAgICAgICAgZnAgPSBoYXNobGliLnNoYTI1NihkZXIpLmhleGRpZ2VzdCgpCiAgICAgICAgICAgICAgICAjIHBhcnNlIFNBTnMgdmlhIGEgc2Vjb25kLCB2YWxpZGF0aW5nLW9mZiBkaWN0IGNlcnQKICAgICAgICBjdHgyID0gc3NsLl9jcmVhdGVfdW52ZXJpZmllZF9jb250ZXh0KCkKICAgICAgICB3aXRoIHNvY2tldC5jcmVhdGVfY29ubmVjdGlvbigoaG9zdCwgNDQzKSwgdGltZW91dD1USU1FT1VUKSBhcyBzb2NrOgogICAgICAgICAgICB3aXRoIGN0eDIud3JhcF9zb2NrZXQoc29jaywgc2VydmVyX2hvc3RuYW1lPWhvc3QpIGFzIHNzOgogICAgICAgICAgICAgICAgaW5mbyA9IHNzLmdldHBlZXJjZXJ0KCkKICAgICAgICBzYW5zID0gW3YgZm9yIGssIHYgaW4gKGluZm8gb3Ige30pLmdldCgic3ViamVjdEFsdE5hbWUiLCBbXSkgaWYgayA9PSAiRE5TIl0KICAgICAgICByZXR1cm4gZnAsIHNhbnMKICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICBwcmludChjKGYiICBbIV0gY2VydCBmZXRjaCBmYWlsZWQ6IHtlfSIsICIzMyIpKQogICAgICAgIHJldHVybiBOb25lLCBbXQoKZGVmIGh0dHBfZ2V0KHVybCwgaG9zdF9oZWFkZXI9Tm9uZSwgaXA9Tm9uZSk6CiAgICAiIiJHRVQgdXJsOyBvcHRpb25hbGx5IG92ZXJyaWRlIEhvc3QgaGVhZGVyIGFuZCBwaW4gdGhlIGNvbm5lY3Rpb24gdG8gaXAuIiIiCiAgICByZXEgPSB1cmxsaWIucmVxdWVzdC5SZXF1ZXN0KHVybCwgaGVhZGVycz17IlVzZXItQWdlbnQiOiAiTW96aWxsYS81LjAifSkKICAgIGlmIGhvc3RfaGVhZGVyOgogICAgICAgIHJlcS5hZGRfdW5yZWRpcmVjdGVkX2hlYWRlcigiSG9zdCIsIGhvc3RfaGVhZGVyKQogICAgY3R4ID0gc3NsLl9jcmVhdGVfdW52ZXJpZmllZF9jb250ZXh0KCkKICAgIHRyeToKICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxLCB0aW1lb3V0PVRJTUVPVVQsIGNvbnRleHQ9Y3R4KSBhcyByOgogICAgICAgICAgICBib2R5ID0gci5yZWFkKDIwMDAwMCkKICAgICAgICAgICAgcmV0dXJuIHIuc3RhdHVzLCBib2R5CiAgICBleGNlcHQgdXJsbGliLmVycm9yLkhUVFBFcnJvciBhcyBlOgogICAgICAgIHJldHVybiBlLmNvZGUsIChlLnJlYWQoMjAwMDAwKSBpZiBlLmZwIGVsc2UgYiIiKQogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICByZXR1cm4gTm9uZSwgYiIiCgpkZWYgdGl0bGVfb2YoYm9keSk6CiAgICB0cnk6CiAgICAgICAgdCA9IGJvZHkuZGVjb2RlKCJ1dGYtOCIsICJpZ25vcmUiKQogICAgZXhjZXB0IEV4Y2VwdGlvbjoKICAgICAgICByZXR1cm4gIiIKICAgIGxvID0gdC5sb3dlcigpCiAgICBpID0gbG8uZmluZCgiPHRpdGxlIikKICAgIGlmIGkgPT0gLTE6CiAgICAgICAgcmV0dXJuICIiCiAgICBqID0gbG8uZmluZCgiPiIsIGkpCiAgICBrID0gbG8uZmluZCgiPC90aXRsZSIsIGopCiAgICByZXR1cm4gdFtqICsgMTprXS5zdHJpcCgpWzo4MF0gaWYgKGogIT0gLTEgYW5kIGsgIT0gLTEpIGVsc2UgIiIKCiMgLS0tLSBpbnRlbCBzb3VyY2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KCmRlZiBmcm9tX2NlbnN5cyhzYW5zLCBmcCk6CiAgICBjaWQsIGNzID0gb3MuZW52aXJvbi5nZXQoIkNFTlNZU19BUElfSUQiKSwgb3MuZW52aXJvbi5nZXQoIkNFTlNZU19BUElfU0VDUkVUIikKICAgIGlmIG5vdCAoY2lkIGFuZCBjcyk6CiAgICAgICAgcmV0dXJuIHNldCgpLCAiY2Vuc3lzOiBubyBDRU5TWVNfQVBJX0lEL1NFQ1JFVCIKICAgIHRyeToKICAgICAgICBpbXBvcnQgYmFzZTY0IGFzIGI2NAogICAgICAgIHEgPSAiIG9yICIuam9pbihbZidzZXJ2aWNlcy50bHMuY2VydGlmaWNhdGVzLmxlYWZfZGF0YS5uYW1lczogIntzfSInIGZvciBzIGluIHNhbnNbOjVdXSkgb3IgZidzZXJ2aWNlcy50bHMuY2VydGlmaWNhdGVzLmxlYWZfZGF0YS5maW5nZXJwcmludF9zaGEyNTY6ICJ7ZnB9IicKICAgICAgICBwYXlsb2FkID0ganNvbi5kdW1wcyh7InEiOiBxLCAicGVyX3BhZ2UiOiA1MH0pLmVuY29kZSgpCiAgICAgICAgcmVxID0gdXJsbGliLnJlcXVlc3QuUmVxdWVzdCgKICAgICAgICAgICAgImh0dHBzOi8vc2VhcmNoLmNlbnN5cy5pby9hcGkvdjIvaG9zdHMvc2VhcmNoIiwKICAgICAgICAgICAgZGF0YT1wYXlsb2FkLCBtZXRob2Q9IlBPU1QiLAogICAgICAgICAgICBoZWFkZXJzPXsiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24iLAogICAgICAgICAgICAgICAgICAgICAiQXV0aG9yaXphdGlvbiI6ICJCYXNpYyAiICsgYjY0LmI2NGVuY29kZShmIntjaWR9Ontjc30iLmVuY29kZSgpKS5kZWNvZGUoKX0sCiAgICAgICAgKQogICAgICAgIHdpdGggdXJsbGliLnJlcXVlc3QudXJsb3BlbihyZXEsIHRpbWVvdXQ9VElNRU9VVCkgYXMgcjoKICAgICAgICAgICAgZGF0YSA9IGpzb24ubG9hZChyKQogICAgICAgIGlwcyA9IHtoLmdldCgiaXAiKSBmb3IgaCBpbiBkYXRhLmdldCgicmVzdWx0Iiwge30pLmdldCgiaGl0cyIsIFtdKSBpZiBoLmdldCgiaXAiKX0KICAgICAgICByZXR1cm4gaXBzLCBmImNlbnN5czoge2xlbihpcHMpfSBjYW5kaWRhdGUocykiCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHNldCgpLCBmImNlbnN5czoge2V9IgoKZGVmIGZyb21fc2hvZGFuKHNhbnMsIGZwKToKICAgIGtleSA9IG9zLmVudmlyb24uZ2V0KCJTSE9EQU5fQVBJX0tFWSIpCiAgICBpZiBub3Qga2V5OgogICAgICAgIHJldHVybiBzZXQoKSwgInNob2Rhbjogbm8gU0hPREFOX0FQSV9LRVkiCiAgICBpcHMgPSBzZXQoKQogICAgdHJ5OgogICAgICAgIGZvciBxdWVyeSBpbiAoW2Yic3NsLmNlcnQuZmluZ2VycHJpbnQ6e2ZwfSJdICsgW2Ync3NsLmNlcnQuc3ViamVjdC5jbjoie3N9IicgZm9yIHMgaW4gc2Fuc1s6Ml1dKToKICAgICAgICAgICAgdXJsID0gZiJodHRwczovL2FwaS5zaG9kYW4uaW8vc2hvZGFuL2hvc3Qvc2VhcmNoP2tleT17a2V5fSZxdWVyeT0iICsgdXJsbGliLnBhcnNlLnF1b3RlKHF1ZXJ5KQogICAgICAgICAgICB0cnk6CiAgICAgICAgICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4odXJsLCB0aW1lb3V0PVRJTUVPVVQpIGFzIHI6CiAgICAgICAgICAgICAgICAgICAgZGF0YSA9IGpzb24ubG9hZChyKQogICAgICAgICAgICAgICAgaXBzIHw9IHttLmdldCgiaXBfc3RyIikgZm9yIG0gaW4gZGF0YS5nZXQoIm1hdGNoZXMiLCBbXSkgaWYgbS5nZXQoImlwX3N0ciIpfQogICAgICAgICAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgICAgICAgICAgY29udGludWUKICAgICAgICByZXR1cm4gaXBzLCBmInNob2Rhbjoge2xlbihpcHMpfSBjYW5kaWRhdGUocykiCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHNldCgpLCBmInNob2Rhbjoge2V9IgoKZGVmIGZyb21fc2VjdXJpdHl0cmFpbHMoZG9tYWluKToKICAgIGtleSA9IG9zLmVudmlyb24uZ2V0KCJTRUNVUklUWVRSQUlMU19BUElfS0VZIikKICAgIGlmIG5vdCBrZXk6CiAgICAgICAgcmV0dXJuIHNldCgpLCAic2VjdXJpdHl0cmFpbHM6IG5vIGtleSIKICAgIHRyeToKICAgICAgICB1cmwgPSBmImh0dHBzOi8vYXBpLnNlY3VyaXR5dHJhaWxzLmNvbS92MS9oaXN0b3J5L3tkb21haW59L2Rucy9hIgogICAgICAgIHJlcSA9IHVybGxpYi5yZXF1ZXN0LlJlcXVlc3QodXJsLCBoZWFkZXJzPXsiQVBJS0VZIjoga2V5fSkKICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxLCB0aW1lb3V0PVRJTUVPVVQpIGFzIHI6CiAgICAgICAgICAgIGRhdGEgPSBqc29uLmxvYWQocikKICAgICAgICBpcHMgPSBzZXQoKQogICAgICAgIGZvciByZWMgaW4gZGF0YS5nZXQoInJlY29yZHMiLCBbXSk6CiAgICAgICAgICAgIGZvciB2IGluIHJlYy5nZXQoInZhbHVlcyIsIFtdKToKICAgICAgICAgICAgICAgIGlmIHYuZ2V0KCJpcCIpOgogICAgICAgICAgICAgICAgICAgIGlwcy5hZGQodlsiaXAiXSkKICAgICAgICByZXR1cm4gaXBzLCBmInNlY3VyaXR5dHJhaWxzOiB7bGVuKGlwcyl9IGhpc3RvcmljYWwgSVAocykiCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHNldCgpLCBmInNlY3VyaXR5dHJhaWxzOiB7ZX0iCgpkZWYgZnJvbV92aXJ1c3RvdGFsKGRvbWFpbik6CiAgICAiIiJWaXJ1c1RvdGFsIHBhc3NpdmUgRE5TIOKAlCBoaXN0b3JpY2FsIEEtcmVjb3JkIHJlc29sdXRpb25zIChmcmVlIHRpZXIpLgogICAgRnJlZSBlcXVpdmFsZW50IG9mIFNlY3VyaXR5VHJhaWxzJyBoaXN0b3JpY2FsIEROUzogZXZlcnkgSVAgdGhlIGRvbWFpbiBoYXMKICAgIHJlc29sdmVkIHRvIHRoYXQgVlQgb2JzZXJ2ZWQsIHBsdXMgc2libGluZyBzdWJkb21haW5zJyBsaXZlIEEgcmVjb3Jkcy4iIiIKICAgIGtleSA9IG9zLmVudmlyb24uZ2V0KCJWSVJVU1RPVEFMX0FQSV9LRVkiKQogICAgaWYgbm90IGtleToKICAgICAgICByZXR1cm4gc2V0KCksICJ2aXJ1c3RvdGFsOiBubyBWSVJVU1RPVEFMX0FQSV9LRVkiCiAgICBpcHMgPSBzZXQoKQogICAgaGRyID0geyJ4LWFwaWtleSI6IGtleX0KICAgIHRyeToKICAgICAgICB1cmwgPSBmImh0dHBzOi8vd3d3LnZpcnVzdG90YWwuY29tL2FwaS92My9kb21haW5zL3tkb21haW59L3Jlc29sdXRpb25zP2xpbWl0PTQwIgogICAgICAgIHJlcSA9IHVybGxpYi5yZXF1ZXN0LlJlcXVlc3QodXJsLCBoZWFkZXJzPWhkcikKICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxLCB0aW1lb3V0PVRJTUVPVVQpIGFzIHI6CiAgICAgICAgICAgIGRhdGEgPSBqc29uLmxvYWQocikKICAgICAgICBmb3IgaXRlbSBpbiBkYXRhLmdldCgiZGF0YSIsIFtdKToKICAgICAgICAgICAgaXAgPSAoaXRlbS5nZXQoImF0dHJpYnV0ZXMiLCB7fSkgb3Ige30pLmdldCgiaXBfYWRkcmVzcyIpCiAgICAgICAgICAgIGlmIGlwOgogICAgICAgICAgICAgICAgaXBzLmFkZChpcCkKICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZToKICAgICAgICByZXR1cm4gaXBzLCBmInZpcnVzdG90YWw6IHtlfSIKICAgIHRyeToKICAgICAgICB1cmwgPSBmImh0dHBzOi8vd3d3LnZpcnVzdG90YWwuY29tL2FwaS92My9kb21haW5zL3tkb21haW59L3N1YmRvbWFpbnM/bGltaXQ9NDAiCiAgICAgICAgcmVxID0gdXJsbGliLnJlcXVlc3QuUmVxdWVzdCh1cmwsIGhlYWRlcnM9aGRyKQogICAgICAgIHdpdGggdXJsbGliLnJlcXVlc3QudXJsb3BlbihyZXEsIHRpbWVvdXQ9VElNRU9VVCkgYXMgcjoKICAgICAgICAgICAgZGF0YSA9IGpzb24ubG9hZChyKQogICAgICAgIGZvciBpdGVtIGluIGRhdGEuZ2V0KCJkYXRhIiwgW10pOgogICAgICAgICAgICBzdWIgPSBpdGVtLmdldCgiaWQiKQogICAgICAgICAgICBpZiBzdWI6CiAgICAgICAgICAgICAgICBmb3IgaXAgaW4gcmVzb2x2ZShzdWIpOgogICAgICAgICAgICAgICAgICAgIGlwcy5hZGQoaXApCiAgICBleGNlcHQgRXhjZXB0aW9uOgogICAgICAgIHBhc3MKICAgIHJldHVybiBpcHMsIGYidmlydXN0b3RhbDoge2xlbihpcHMpfSBoaXN0b3JpY2FsL3NpYmxpbmcgSVAocykiCgpkZWYgZnJvbV9jcnRzaChkb21haW4pOgogICAgdHJ5OgogICAgICAgIGltcG9ydCB1cmxsaWIucGFyc2UKICAgICAgICB1cmwgPSBmImh0dHBzOi8vY3J0LnNoLz9xPSUyNS57dXJsbGliLnBhcnNlLnF1b3RlKGRvbWFpbil9Jm91dHB1dD1qc29uIgogICAgICAgIHJlcSA9IHVybGxpYi5yZXF1ZXN0LlJlcXVlc3QodXJsLCBoZWFkZXJzPXsiVXNlci1BZ2VudCI6ICJjZi1vcmlnaW4ifSkKICAgICAgICB3aXRoIHVybGxpYi5yZXF1ZXN0LnVybG9wZW4ocmVxLCB0aW1lb3V0PVRJTUVPVVQpIGFzIHI6CiAgICAgICAgICAgIGRhdGEgPSBqc29uLmxvYWQocikKICAgICAgICBuYW1lcyA9IHNldCgpCiAgICAgICAgZm9yIHJvdyBpbiBkYXRhOgogICAgICAgICAgICBmb3IgbiBpbiAocm93LmdldCgibmFtZV92YWx1ZSIsICIiKSBvciAiIikuc3BsaXQoIlxuIik6CiAgICAgICAgICAgICAgICBuID0gbi5zdHJpcCgpLmxzdHJpcCgiKi4iKQogICAgICAgICAgICAgICAgaWYgbi5lbmRzd2l0aChkb21haW4pOgogICAgICAgICAgICAgICAgICAgIG5hbWVzLmFkZChuKQogICAgICAgIHJldHVybiBuYW1lcywgZiJjcnQuc2g6IHtsZW4obmFtZXMpfSByZWxhdGVkIGhvc3QocykiCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgcmV0dXJuIHNldCgpLCBmImNydC5zaDoge2V9IgoKIyAtLS0tIG1haW4gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQoKZGVmIG1haW4oKToKICAgIGltcG9ydCB1cmxsaWIucGFyc2UgICMgbm9xYQogICAgaWYgbGVuKHN5cy5hcmd2KSA8IDI6CiAgICAgICAgcHJpbnQoInVzYWdlOiBjZi1vcmlnaW4gPGRvbWFpbj4iKQogICAgICAgIHN5cy5leGl0KDEpCiAgICBkb21haW4gPSBzeXMuYXJndlsxXS5zdHJpcCgpLnJlcGxhY2UoImh0dHBzOi8vIiwgIiIpLnJlcGxhY2UoImh0dHA6Ly8iLCAiIikucnN0cmlwKCIvIikuc3BsaXQoIi8iKVswXQogICAgcHJpbnQoYyhmIlxuPT09IGNmLW9yaWdpbiA6OiBodW50aW5nIG9yaWdpbiBiZWhpbmQgdGhlIGVkZ2UgZm9yIHtkb21haW59ID09PVxuIiwgIjE7MzYiKSkKCiAgICBhID0gcmVzb2x2ZShkb21haW4pCiAgICBjZl9hbGwgPSBhIGFuZCBhbGwoaXNfY2YoaXApIGZvciBpcCBpbiBhKQogICAgcHJpbnQoZiJBIHJlY29yZHM6IHsnLCAnLmpvaW4oYSkgb3IgJ25vbmUnfSIpCiAgICBwcmludCgiZWRnZSAgICAgOiAiICsgKGMoIkNsb3VkZmxhcmUgKGFsbCBBIHJlY29yZHMgYXJlIENGKSIsICIzMyIpIGlmIGNmX2FsbCBlbHNlICJub3QgZnVsbHkgQ0YtZnJvbnRlZCIgaWYgYSBlbHNlICJ1bnJlc29sdmVkIikpCgogICAgZnAsIHNhbnMgPSBnZXRfY2VydChkb21haW4pCiAgICBpZiBmcDoKICAgICAgICBwcmludChmImNlcnQgICAgIDogc2hhMjU2PXtmcFs6MjRdfeKApiAgU0FOcz17JywgJy5qb2luKHNhbnNbOjZdKSBvciAnLSd9IikKCiAgICAjIGJhc2VsaW5lIHZpYSBlZGdlCiAgICBiYXNlX3N0YXR1cywgYmFzZV9ib2R5ID0gaHR0cF9nZXQoZiJodHRwczovL3tkb21haW59LyIpCiAgICBiYXNlX3RpdGxlID0gdGl0bGVfb2YoYmFzZV9ib2R5KQogICAgYmFzZV9sZW4gPSBsZW4oYmFzZV9ib2R5KQogICAgcHJpbnQoZiJiYXNlbGluZSA6IHN0YXR1cz17YmFzZV9zdGF0dXN9IGxlbj17YmFzZV9sZW59IHRpdGxlPXtiYXNlX3RpdGxlIXJ9XG4iKQoKICAgICMgZ2F0aGVyIGNhbmRpZGF0ZXMKICAgIGNhbmRzLCBub3RlcyA9IHNldCgpLCBbXQogICAgZm9yIGZuLCBhcmdzIGluIFsoZnJvbV9jZW5zeXMsIChzYW5zLCBmcCkpLCAoZnJvbV9zaG9kYW4sIChzYW5zLCBmcCkpLAogICAgICAgICAgICAgICAgICAgICAoZnJvbV9zZWN1cml0eXRyYWlscywgKGRvbWFpbiwpKSwgKGZyb21fdmlydXN0b3RhbCwgKGRvbWFpbiwpKV06CiAgICAgICAgaXBzLCBub3RlID0gZm4oKmFyZ3MpCiAgICAgICAgY2FuZHMgfD0gaXBzCiAgICAgICAgbm90ZXMuYXBwZW5kKG5vdGUpCiAgICBob3N0cywgbm90ZSA9IGZyb21fY3J0c2goZG9tYWluKQogICAgbm90ZXMuYXBwZW5kKG5vdGUpCiAgICBmb3IgaCBpbiBob3N0czoKICAgICAgICBmb3IgaXAgaW4gcmVzb2x2ZShoKToKICAgICAgICAgICAgY2FuZHMuYWRkKGlwKQoKICAgIHByaW50KGMoImludGVsIHNvdXJjZXM6IiwgIjEiKSkKICAgIGZvciBuIGluIG5vdGVzOgogICAgICAgIHByaW50KCIgIC0gIiArIG4pCgogICAgY2FuZHMgPSB7aXAgZm9yIGlwIGluIGNhbmRzIGlmIGlwIGFuZCBub3QgaXNfY2YoaXApIGFuZCBpcCBub3QgaW4gYX0KICAgIHByaW50KGMoZiJcbm5vbi1DRiBjYW5kaWRhdGUgSVBzIHRvIHZhbGlkYXRlOiB7bGVuKGNhbmRzKX0iLCAiMSIpKQogICAgaWYgbm90IGNhbmRzOgogICAgICAgIHByaW50KGMoIiAgbm9uZSDigJQgb3JpZ2luIGlzIG5vdCBleHBvc2VkIHZpYSBjZXJ0L0ROUyBpbnRlbCBhdmFpbGFibGUuIiwgIjMzIikpCiAgICAgICAgaWYgbm90IGFueSgiY2FuZGlkYXRlIiBpbiBuIG9yICJoaXN0b3JpY2FsIiBpbiBuIG9yICJzaWJsaW5nIiBpbiBuIGZvciBuIGluIG5vdGVzKToKICAgICAgICAgICAgcHJpbnQoYygiICAoYWRkIFZJUlVTVE9UQUwvU0hPREFOIGtleXMgZm9yIGEgcmVhbCBodW50IOKAlCBhbGwgc291cmNlcyB3ZXJlIGJsaW5kLikiLCAiMzMiKSkKICAgICAgICBwcmludCgpCiAgICAgICAgcmV0dXJuCgogICAgIyB2YWxpZGF0ZQogICAgaGl0cyA9IFtdCiAgICBmb3IgaXAgaW4gc29ydGVkKGNhbmRzKToKICAgICAgICBzdCwgYm9keSA9IGh0dHBfZ2V0KGYiaHR0cHM6Ly97aXB9LyIsIGhvc3RfaGVhZGVyPWRvbWFpbiwgaXA9aXApCiAgICAgICAgaWYgc3QgaXMgTm9uZToKICAgICAgICAgICAgY29udGludWUKICAgICAgICB0ID0gdGl0bGVfb2YoYm9keSkKICAgICAgICBtYXRjaCA9ICh0IGFuZCB0ID09IGJhc2VfdGl0bGUpIG9yIChiYXNlX2xlbiBhbmQgYWJzKGxlbihib2R5KSAtIGJhc2VfbGVuKSAvIG1heChiYXNlX2xlbiwgMSkgPCAwLjE1KQogICAgICAgIHRhZyA9IGMoIk9SSUdJTiBNQVRDSCIsICIxOzMyIikgaWYgbWF0Y2ggZWxzZSAibm8gbWF0Y2giCiAgICAgICAgcHJpbnQoZiIgIHtpcDo8MTZ9IHN0YXR1cz17c3R9IGxlbj17bGVuKGJvZHkpfSB0aXRsZT17dCFyfSAgLT4ge3RhZ30iKQogICAgICAgIGlmIG1hdGNoOgogICAgICAgICAgICBoaXRzLmFwcGVuZChpcCkKCiAgICBwcmludCgpCiAgICBpZiBoaXRzOgogICAgICAgIHByaW50KGMoZiJbK10gTElLRUxZIE9SSUdJTihTKTogeycsICcuam9pbihoaXRzKX0iLCAiMTszMiIpKQogICAgICAgIHByaW50KGMoZiIgICAgdmVyaWZ5OiBjdXJsIC1rIC1IICdIb3N0OiB7ZG9tYWlufScgaHR0cHM6Ly97aGl0c1swXX0vIiwgIjMyIikpCiAgICBlbHNlOgogICAgICAgIHByaW50KGMoIlstXSBubyBjYW5kaWRhdGUgcmVwcm9kdWNlZCB0aGUgc2l0ZTsgb3JpZ2luIGxpa2VseSBsb2NrZWQgdG8gQ0YgaW5ncmVzcy4iLCAiMzMiKSkKICAgIHByaW50KCkKCmlmIF9fbmFtZV9fID09ICJfX21haW5fXyI6CiAgICBtYWluKCkK' \
      | base64 -d > /usr/local/bin/cf-origin; \
    chmod +x /usr/local/bin/cf-origin; \
    python3 -c "import ast; ast.parse(open('/usr/local/bin/cf-origin').read())" && echo "cf-origin: syntax OK"

# Symlink searchsploit if exploitdb landed under a non-PATH location
RUN set -eux; \
    if [ -x /usr/bin/searchsploit ] || command -v searchsploit >/dev/null 2>&1; then \
      echo "searchsploit present"; \
    elif [ -x /opt/exploitdb/searchsploit ]; then \
      ln -sf /opt/exploitdb/searchsploit /usr/local/bin/searchsploit; \
    fi

# ============================================================================
# TestSSL Symlink - Allow access via both 'testssl' and 'testssl.sh'
# ============================================================================
RUN set -eux; \
    if command -v testssl >/dev/null 2>&1; then \
      ln -sf $(which testssl) /usr/local/bin/testssl.sh; \
    fi

# ============================================================================
# Nuclei Templates
# Templates are intentionally NOT downloaded at build time (saves significant
# disk). Nuclei fetches them automatically on first run, or run
# `nuclei -update-templates` at runtime.
# ============================================================================

# ============================================================================
# Tool Validation
# ============================================================================
RUN set -eux; \
    echo "=== Starting tool validation ===" && \
    test -d /usr/share/seclists && \
    echo "✓ SecLists installed" && \
    which nmap && echo "✓ nmap" && \
    which naabu && echo "✓ naabu" && \
    which nikto && echo "✓ nikto" && \
    which whatweb && echo "✓ whatweb" && \
    which wafw00f && echo "✓ wafw00f" && \
    which sqlmap && echo "✓ sqlmap" && \
    which wapiti && echo "✓ wapiti" && \
    which wpscan && echo "✓ wpscan" && \
    which subfinder && echo "✓ subfinder" && \
    which dnsrecon && echo "✓ dnsrecon" && \
    which dnsenum && echo "✓ dnsenum" && \
    which ffuf && echo "✓ ffuf" && \
    which arjun && echo "✓ arjun" && \
    which gobuster && echo "✓ gobuster" && \
    which dirsearch && echo "✓ dirsearch" && \
    which testssl && echo "✓ testssl" && \
    which testssl.sh && echo "✓ testssl.sh" && \
    which nuclei && echo "✓ nuclei" && \
    which hydra && echo "✓ hydra" && \
    which smbclient && echo "✓ smbclient" && \
    which smbmap && echo "✓ smbmap" && \
    which nbtscan && echo "✓ nbtscan" && \
    which enum4linux && echo "✓ enum4linux" && \
    which enum4linux-aux && echo "✓ enum4linux-aux" && \
    which arp-scan && echo "✓ arp-scan" && \
    which crackmapexec && echo "✓ crackmapexec" && \
    which bloodhound-python && echo "✓ bloodhound-python" && \
    which adb && echo "✓ adb" && \
    which apktool && echo "✓ apktool" && \
    which aws && echo "✓ awscli" && \
    which az && echo "✓ azure-cli" && \
    which gcloud && echo "✓ google-cloud-sdk" && \
    which wfuzz && echo "✓ wfuzz" && \
    which burpsuite && echo "✓ burpsuite" && \
    which gospider && echo "✓ gospider" && \
    which interactsh-client && echo "✓ interactsh-client" && \
    which katana && echo "✓ katana" && \
    which cvemap && echo "✓ cvemap" && \
    which jwt-tool && echo "✓ jwt_tool" && \
    which gitdumper && echo "✓ gitdumper" && \
    which trufflehog && echo "✓ trufflehog" && \
    which trivy && echo "✓ trivy" && \
    which zaproxy && echo "✓ zaproxy" && \
    which httpx && echo "✓ httpx" && \
    which caido-cli && echo "✓ caido-cli" && \
    which rg && echo "✓ ripgrep" && \
    which go && echo "✓ go" && \
    which python3 && echo "✓ python3" && \
    which node && echo "✓ node" && \
    which ruby && echo "✓ ruby" && \
    which tmux && echo "✓ tmux" && \
    python3 -c "import reportlab; print('✓ reportlab')" && \
    python3 -c "import docx; print('✓ python-docx')" && \
    python3 -c "import openpyxl; print('✓ openpyxl')" && \
    python3 -c "import pptx; print('✓ python-pptx')" && \
    python3 -c "import pandas; print('✓ pandas')" && \
    python3 -c "import odf; print('✓ odfpy')" && \
    python3 -c "import requests; print('✓ requests')" && \
    python3 -c "import ldapdomaindump; print('✓ ldapdomaindump')" && \
    python3 -c "import impacket; print('✓ impacket')" && \
    python3 -c "import frida; print('✓ frida-tools')" && \
    python3 -c "import objection; print('✓ objection')" && \
    python3 -c "import androguard; print('✓ androguard')" && \
    python3 -c "import ScoutSuite; print('✓ ScoutSuite')" && \
    python3 -c "import graphql; print('✓ graphql-core')" && \
    echo "=== Version Information ===" && \
    nmap --version | head -n1 && \
    python3 --version && \
    go version && \
    node --version && \
    ruby --version && \
    echo "=== All critical tools validated successfully ==="

# ============================================================================
# Final Cleanup & Permissions
# ============================================================================
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /var/cache/apt/archives/* && \
    chown -R user:user /home/user

# Default shell
SHELL ["/bin/bash", "-c"]
