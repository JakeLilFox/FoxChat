FROM archlinux:base-devel AS tools

RUN pacman -Syu --noconfirm --needed cargo
RUN cargo install tauri-driver --locked --root /opt/tauri-driver

FROM ubuntu:24.04 AS webdriver

RUN apt-get update \
    && apt-get install -y --no-install-recommends webkit2gtk-driver \
    && mkdir -p /opt/webkit-webdriver/lib \
    && cp /usr/bin/WebKitWebDriver /opt/webkit-webdriver/WebKitWebDriver \
    && cp -a /usr/lib/x86_64-linux-gnu/libicu*.so.74* /opt/webkit-webdriver/lib/ \
    && rm -rf /var/lib/apt/lists/*

FROM archlinux:base

RUN pacman -Syu --noconfirm --needed \
      appmenu-gtk-module \
      bash \
      ca-certificates \
      dbus \
      fuse2 \
      gtk3 \
      libappindicator-gtk3 \
      librsvg \
      mesa \
      nodejs \
      ttf-dejavu \
      webkit2gtk-4.1 \
      xorg-server-xvfb \
      xorg-xauth \
    && pacman -Scc --noconfirm

COPY --from=tools /opt/tauri-driver/bin/tauri-driver /usr/local/bin/tauri-driver
COPY --from=webdriver /opt/webkit-webdriver /opt/webkit-webdriver
COPY tests/appimage/webkit-webdriver.sh /usr/local/bin/WebKitWebDriver
COPY scripts/appimage-smoke.mjs /opt/foxchat-test/appimage-smoke.mjs
COPY tests/appimage/run.sh /opt/foxchat-test/run.sh

RUN chmod +x /opt/foxchat-test/run.sh /usr/local/bin/WebKitWebDriver

ENTRYPOINT ["/opt/foxchat-test/run.sh"]
