package io.github.ghahremany.yarvan.companion;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Parses one user-approved HTTPS origin without persisting invitation query or fragment data. */
final class WorkspaceUrl {
    final String page;
    final String origin;

    private WorkspaceUrl(String page, String origin) {
        this.page = page;
        this.origin = origin;
    }

    static WorkspaceUrl parse(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.length() > 8192 || value.indexOf('\\') >= 0) return null;
        try {
            URI uri = new URI(value);
            int port = uri.getPort();
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null || host == null ||
                    (port != -1 && (port < 1 || port > 65535)) || uri.getRawAuthority().endsWith(":")) return null;
            host = host.toLowerCase(Locale.ROOT);
            if ("localhost".equals(host) || "localhost.".equals(host) || host.startsWith("127.") || "[::1]".equals(host)) return null;
            String origin = "https://" + host + (port != -1 && port != 443 ? ":" + port : "");
            String path = uri.getRawPath();
            String page = origin + (path.isEmpty() ? "/" : path);
            if (uri.getRawQuery() != null) page += "?" + uri.getRawQuery();
            if (uri.getRawFragment() != null) page += "#" + uri.getRawFragment();
            return new WorkspaceUrl(page, origin);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }

    boolean allows(String next) {
        WorkspaceUrl target = parse(next);
        return target != null && origin.equals(target.origin);
    }
}
