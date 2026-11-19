package io.github.ghahremany.yarvan.companion;

final class WorkspaceUrlTest {
    private static void expect(boolean value) { if (!value) throw new AssertionError("Workspace URL policy failed"); }
    public static void main(String[] args) {
        WorkspaceUrl about = WorkspaceUrl.parse(" HTTPS://Yarvan.example:443/pair?q=preview#code=TEST ");
        expect(about != null && "https://yarvan.example".equals(about.origin));
        expect("https://yarvan.example/pair?q=preview#code=TEST".equals(about.page));
        expect(about.allows("https://yarvan.example/next"));
        expect(!about.allows("https://yarvan.example:9443/next"));
        expect(!about.allows("https://yarvan.example.evil.test/"));
        expect("https://[2001:db8::10]:9443".equals(WorkspaceUrl.parse("https://[2001:db8::10]:9443/").origin));
        for (String refused : new String[] {"http://yarvan.example", "file:///data/test", "content://android.test/x", "javascript:1", "https://user:pass@yarvan.example", "https://yarvan.example\\@other.test", "https://yarvan.example:/", "https://yarvan.example:65536/", "https://127.0.0.1:8799/", "https://[::1]/", "https://localhost/", "https://yarvan.example\n/", "https:///"}) {
            expect(WorkspaceUrl.parse(refused) == null);
        }
        System.out.println("HTTPS origin and pairing link policy: passed");
    }
}
