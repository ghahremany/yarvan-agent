package io.github.ghahremany.yarvan.companion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int PAPER = 0xfff6f8f7;
    private static final int INK = 0xff101a29;
    private static final int GREEN = 0xff007a46;
    private static final int SUBTLE = 0xff4c5b55;
    private static final String ORIGIN = "workspace_origin";
    private SharedPreferences settings;
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        settings = getSharedPreferences("connection", MODE_PRIVATE);
        showSetup(0);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private GradientDrawable surface(int color, int radius, int border) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        if (border != 0) drawable.setStroke(dp(1), border);
        return drawable;
    }

    private TextView text(int id, int size, int color) {
        TextView view = new TextView(this);
        view.setText(id);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout column() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setBackgroundColor(PAPER);
        return row;
    }

    private Button button(int label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setMinHeight(dp(48));
        b.setTextColor(primary ? Color.WHITE : GREEN);
        b.setBackgroundTintList(ColorStateList.valueOf(primary ? GREEN : 0xffe7f2eb));
        return b;
    }

    private void mount(View root) {
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            root.requestApplyInsets();
        }
    }

    private void disposeWeb() {
        WebView old = web;
        web = null;
        if (old == null) return;
        old.stopLoading();
        if (old.getParent() instanceof LinearLayout) ((LinearLayout) old.getParent()).removeView(old);
        old.destroy();
        CookieManager.getInstance().flush();
    }

    private void showSetup(int error) {
        disposeWeb();
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(PAPER);
        scroll.setFillViewport(true);
        LinearLayout layout = column();
        layout.setPadding(dp(24), dp(32), dp(24), dp(24));
        scroll.addView(layout);

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.yarvan_icon);
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        layout.addView(icon, new LinearLayout.LayoutParams(dp(64), dp(64)));
        TextView badge = text(R.string.badge, 12, GREEN);
        badge.setTypeface(null, Typeface.BOLD);
        badge.setPadding(0, dp(21), 0, dp(6));
        layout.addView(badge);
        TextView title = text(R.string.title, 29, INK);
        title.setTypeface(null, Typeface.BOLD);
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        layout.addView(title);
        TextView intro = text(R.string.intro, 15, SUBTLE);
        intro.setPadding(0, dp(9), 0, dp(23));
        layout.addView(intro);

        TextView label = text(R.string.address, 14, INK);
        label.setTypeface(null, Typeface.BOLD);
        layout.addView(label);
        EditText input = new EditText(this);
        input.setId(View.generateViewId());
        label.setLabelFor(input.getId());
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        input.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        input.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        input.setSingleLine(true);
        input.setSelectAllOnFocus(false);
        input.setSaveEnabled(false); // A pasted invitation must not go into activity state or autofill.
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setImeOptions(EditorInfo.IME_ACTION_GO | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        input.setHint(R.string.hint);
        input.setText(settings.getString(ORIGIN, ""));
        input.setTextSize(14);
        input.setPadding(dp(12), dp(8), dp(12), dp(8));
        input.setBackground(surface(Color.WHITE, 11, 0xffd4dfd9));
        LinearLayout.LayoutParams field = new LinearLayout.LayoutParams(-1, dp(52));
        field.topMargin = dp(7);
        layout.addView(input, field);
        Button open = button(R.string.connect, true);
        LinearLayout.LayoutParams action = new LinearLayout.LayoutParams(-1, -2);
        action.topMargin = dp(10);
        layout.addView(open, action);
        TextView description = text(error == 0 ? R.string.safe : error, 14, error == 0 ? SUBTLE : 0xffa72532);
        description.setPadding(0, dp(16), 0, dp(8));
        layout.addView(description);
        TextView offline = text(R.string.offline_notice, 13, SUBTLE);
        layout.addView(offline);
        if (settings.contains(ORIGIN)) {
            layout.addView(button(R.string.forget, false));
            layout.getChildAt(layout.getChildCount() - 1).setOnClickListener(v -> new AlertDialog.Builder(this)
                .setMessage(R.string.confirm_forget).setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.forget_ok, (dialog, which) -> {
                    settings.edit().remove(ORIGIN).apply();
                    CookieManager.getInstance().removeAllCookies(ignored -> CookieManager.getInstance().flush());
                    WebStorage.getInstance().deleteAllData();
                    showSetup(0);
                }).show());
        }
        View.OnClickListener launch = ignored -> {
            WorkspaceUrl target = WorkspaceUrl.parse(input.getText().toString());
            if (target == null) { input.setError(getString(R.string.invalid_url)); return; }
            settings.edit().putString(ORIGIN, target.origin).apply();
            input.setText(target.origin); // Drop the pairing code from the native input before switching views.
            android.view.inputmethod.InputMethodManager ime = getSystemService(android.view.inputmethod.InputMethodManager.class);
            if (ime != null) ime.hideSoftInputFromWindow(input.getWindowToken(), 0);
            openWorkspace(target);
        };
        open.setOnClickListener(launch);
        input.setOnEditorActionListener((v, actionId, e) -> {
            if (actionId != EditorInfo.IME_ACTION_GO) return false;
            launch.onClick(v);
            return true;
        });
        layout.setFocusableInTouchMode(true);
        layout.requestFocus();
        mount(scroll);
    }

    private void openWorkspace(WorkspaceUrl target) {
        disposeWeb();
        LinearLayout layout = column();
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(4), dp(12), dp(4));
        TextView name = text(R.string.app_name, 16, INK);
        name.setTypeface(null, Typeface.BOLD);
        bar.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        Button change = button(R.string.settings, false);
        change.setOnClickListener(v -> showSetup(0));
        bar.addView(change);
        layout.addView(bar);
        ProgressBar loading = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        loading.setIndeterminate(true);
        layout.addView(loading, new LinearLayout.LayoutParams(-1, dp(3)));

        try {
            web = new WebView(this);
        } catch (RuntimeException unavailable) {
            showSetup(R.string.network_error);
            return;
        }
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true); // Only the user-approved workspace runs in this view; no JavaScript bridge.
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setAllowFileAccessFromFileURLs(false);
        ws.setAllowUniversalAccessFromFileURLs(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ws.setSupportMultipleWindows(false);
        ws.setJavaScriptCanOpenWindowsAutomatically(false);
        ws.setGeolocationEnabled(false);
        ws.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame() || target.allows(request.getUrl().toString())) return false;
                Toast.makeText(MainActivity.this, R.string.external_blocked, Toast.LENGTH_SHORT).show();
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (view == web && !target.allows(url)) { showSetup(R.string.external_blocked); return; }
                loading.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) { loading.setVisibility(View.GONE); }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (view == web) view.post(() -> { if (view == web) showSetup(R.string.tls_error); });
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && view == web) view.post(() -> { if (view == web) showSetup(R.string.network_error); });
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view == web) showSetup(R.string.network_error);
                return true;
            }
        });
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        mount(layout);
        web.loadUrl(target.page);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else if (web != null) showSetup(0);
        else super.onBackPressed();
    }

    @Override protected void onDestroy() { disposeWeb(); super.onDestroy(); }
}
