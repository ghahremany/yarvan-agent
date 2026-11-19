# Install Yarvan and pair an Android device

[Releases](https://github.com/ghahremany/yarvan-agent/releases) · [فارسی](install-fa.md)

## Windows x64

Download the `*-windows-x64-setup.exe` installer. Compare its SHA-256 with `SHA256SUMS.txt` from the same release (in PowerShell, run `Get-FileHash .\Yarvan-0.1.1-beta.1-windows-x64-setup.exe -Algorithm SHA256`). Launch the installer, then open **Yarvan** from Start. It is not Authenticode-signed; Windows may show an unknown publisher. Respect your system or organization's install policy. You do not need a separate Node.js installation.

## Linux x86_64

Use the `.deb` on Ubuntu 24.04. APT installs required libraries and the package sets up its own browser sandbox policy:

```sh
sha256sum Yarvan-0.1.1-beta.1-linux-amd64.deb
sudo apt install ./Yarvan-0.1.1-beta.1-linux-amd64.deb
```

Open **Yarvan** from the application menu. The AppImage is a portable option for distributions that support the Electron libraries and Chromium sandbox. Mark it executable before launching. If it does not launch due to Ubuntu's namespace policy, use the DEB; do not disable AppArmor or the sandbox. Desktop workspace data is separate from OpenMausBot, in `~/.yarvan` by default. Choose a model from Settings. To update Yarvan, install a newer release; there is no automatic upstream update feed.

## Android 8+ — companion app

1. Verify the `*-android.apk` hash from the official GitHub release before installing. If Android prompts for permission to install from outside the store, grant it only to the app opening that APK and remove the permission afterward.
2. Keep **Yarvan running on your computer or server**. The phone needs a reachable workspace URL with HTTPS and a certificate trusted by Android. The product page, a loopback address and plain HTTP are not workspace URLs.
3. A private option on desktop is [Tailscale](../desktop-companion.md). Connect the host and phone to the same tailnet. Enable MagicDNS and HTTPS Certificates. On the host, go to **Settings → Phone & devices → Your other computers**. Once the `https://…ts.net` address is ready, choose **Pair a computer → Copy link**. Use that one-time browser pairing link, not the six-digit **Pair a phone** code or the native relay QR. Pick chat-only access when available and sufficient.
4. Paste the link into **Yarvan Companion** and tap **Open workspace**. Treat the link as sensitive. The app remembers the origin, not the pasted code in its settings. A browser session is stored by Android WebView for reconnections. If pairing expires, ask the host for another link.
5. To remove a lost or replaced phone's access, revoke its browser session on the host in **Phone & devices → Paired**. To clear this device's saved address and browser data, use **Connection settings → Forget this workspace** in the companion. Clearing local data is not a substitute for host-side revocation.

For a self-hosted **Yarvan** server, see the HTTPS proxy and browser pairing concepts in [self-hosting](../self-hosting.md). Do not forward the owner-trusted loopback listener directly to the internet, and don't install the upstream package in place of this fork. Configure model-provider sign-in on a trusted host, not by following external sign-in pages inside the companion. Update Android System WebView if pages fail to load. The APK contains no on-device agent, offline execution, native relay or push notifications.
