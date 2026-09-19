package com.hishamsiam.gyrostrike;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * Hosts the HTML5 game in a full-screen landscape WebView. The web files are
 * bundled as assets and served from https://appassets.androidplatform.net/ so
 * the page runs in a secure context. Orientation sensors and persistent
 * storage are provided natively through {@link GameBridge}, which the page
 * reaches as {@code window.AndroidBridge}.
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView webView;
    private GameBridge bridge;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        setContentView(webView);
        hideSystemBars();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        webView.setBackgroundColor(0xFF0B1220);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        bridge = new GameBridge(this);
        webView.addJavascriptInterface(bridge, "AndroidBridge");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep navigation inside the bundled game.
                return !request.getUrl().toString().startsWith("https://appassets.androidplatform.net/");
            }
        });

        webView.loadUrl(START_URL);
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), webView);
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onPause() {
        super.onPause();
        bridge.stop();
        webView.evaluateJavascript("window.GyroStrike && GyroStrike.onAppPause && GyroStrike.onAppPause();", null);
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        bridge.start();
    }

    @Override
    protected void onDestroy() {
        bridge.stop();
        webView.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Let the game show its pause menu instead of leaving the activity.
        webView.evaluateJavascript(
                "window.GyroStrike && GyroStrike.onBackButton ? GyroStrike.onBackButton() : false;",
                value -> {
                    if (!"true".equals(value)) finish();
                });
    }
}
