package sa.news.reader

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Hosts the bundled web app in a WebView and gives it two local endpoints that a
 * normal web page cannot have:
 *   /proxy?url=…    fetches any http(s) URL from the phone (feeds, article pages)
 *   /render?url=…   opens a page in a hidden browser view and returns its rendered HTML
 * Nothing is sent to any server other than the news sources themselves.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private lateinit var userAgent: String
    private val main = Handler(Looper.getMainLooper())
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        userAgent = WebSettings.getDefaultUserAgent(this).replace("; wv", "")
        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        setContentView(root)

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
        }
        web.addJavascriptInterface(Bridge(), "Native")

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                if (uri.host != HOST) return null
                return when (uri.path) {
                    "/proxy" -> proxy(uri.getQueryParameter("url"))
                    "/render" -> render(uri.getQueryParameter("url"))
                    else -> assets.shouldInterceptRequest(uri)
                }
            }

            // Links that leave the app (the original article, YouTube) open in the browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || request.url.host == HOST) return false
                openExternally(request.url)
                return true
            }
        }

        // Lets embedded videos go full screen.
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                fullscreenView?.let { root.removeView(it) }
                fullscreenView = view
                fullscreenCallback = callback
                root.addView(view, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                web.visibility = View.GONE
            }

            override fun onHideCustomView() {
                fullscreenView?.let { root.removeView(it) }
                fullscreenView = null
                fullscreenCallback = null
                web.visibility = View.VISIBLE
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreenView != null) {
                    fullscreenCallback?.onCustomViewHidden()
                    web.webChromeClient?.onHideCustomView()
                    return
                }
                web.evaluateJavascript("window.__back ? window.__back() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })

        if (savedInstanceState == null) web.loadUrl("https://$HOST/assets/www/index.html")
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        root.removeAllViews()
        web.destroy()
        super.onDestroy()
    }

    private fun openExternally(uri: Uri) {
        if (uri.scheme != "http" && uri.scheme != "https") return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
        }
    }

    private fun respond(status: Int, reason: String, body: ByteArray, headers: Map<String, String> = emptyMap()) =
        WebResourceResponse("application/octet-stream", null, status, reason, headers + ("Cache-Control" to "no-store"), ByteArrayInputStream(body))

    private fun httpUrl(raw: String?): URL? = try {
        URL(raw).takeIf { it.protocol == "http" || it.protocol == "https" }
    } catch (_: Exception) {
        null
    }

    /** Runs on a WebView worker thread, so blocking network I/O is fine here. */
    private fun proxy(raw: String?): WebResourceResponse {
        var url = httpUrl(raw) ?: return respond(400, "Bad Request", ByteArray(0))
        try {
            repeat(MAX_REDIRECTS) {
                val conn = url.openConnection() as HttpURLConnection
                try {
                    conn.instanceFollowRedirects = false
                    conn.connectTimeout = 12000
                    conn.readTimeout = 15000
                    conn.setRequestProperty("User-Agent", userAgent)
                    conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*;q=0.8")
                    conn.setRequestProperty("Accept-Language", "ar,en;q=0.8")
                    if (url.host.endsWith("youtube.com")) conn.setRequestProperty("Cookie", "SOCS=CAI; CONSENT=YES+1")

                    val code = conn.responseCode
                    if (code in 300..399) {
                        val next = conn.getHeaderField("Location") ?: return respond(502, "Bad Gateway", ByteArray(0))
                        url = httpUrl(URL(url, next).toString()) ?: return respond(502, "Bad Gateway", ByteArray(0))
                        return@repeat
                    }
                    val stream = if (code >= 400) conn.errorStream else conn.inputStream
                    val body = stream?.use { readLimited(it) } ?: ByteArray(0)
                    val status = if (code in 200..599) code else 502
                    return respond(
                        status, conn.responseMessage?.takeIf { it.isNotBlank() } ?: "Response", body,
                        mapOf("X-Upstream-Type" to (conn.contentType ?: ""), "X-Final-Url" to url.toString())
                    )
                } finally {
                    conn.disconnect()
                }
            }
            return respond(502, "Too Many Redirects", ByteArray(0))
        } catch (_: Exception) {
            return respond(502, "Bad Gateway", ByteArray(0))
        }
    }

    private fun readLimited(input: java.io.InputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (out.size() < MAX_BODY) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /**
     * Opens a page in a real, hidden browser view and returns its final address
     * and rendered HTML as JSON. Unlike a plain download this follows
     * news-aggregator redirect links, runs the page's scripts, and is treated by
     * publishers as an ordinary visitor. Images are not downloaded.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun render(raw: String?): WebResourceResponse {
        val start = httpUrl(raw) ?: return respond(400, "Bad Request", ByteArray(0))
        val done = CountDownLatch(1)
        var html: String? = null
        var finalUrl: String? = null
        var probe: WebView? = null
        var closed = false

        fun isPublisher(candidate: String?): Boolean {
            val host = try { Uri.parse(candidate).host ?: "" } catch (_: Exception) { "" }
            return host.isNotEmpty() && !host.endsWith("google.com") && !host.endsWith("bing.com")
        }

        main.post {
            val view = WebView(this)
            probe = view
            view.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                blockNetworkImage = true
                mediaPlaybackRequiresUserGesture = true
                userAgentString = userAgent
            }
            // Sits behind the visible page so sites see a normal, laid-out view.
            root.addView(view, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

            var grabbing = false
            fun grab(delay: Long) {
                if (grabbing || closed) return
                grabbing = true
                main.postDelayed({
                    if (closed) return@postDelayed
                    view.evaluateJavascript("document.documentElement.outerHTML") { value ->
                        html = value
                        finalUrl = view.url
                        done.countDown()
                    }
                }, delay)
            }

            view.webViewClient = object : WebViewClient() {
                override fun onPageFinished(v: WebView, url: String?) {
                    if (isPublisher(url)) grab(1200)
                }

                // Stay on web pages: ignore app links, store links and the like.
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val scheme = request.url.scheme
                    return scheme != "http" && scheme != "https"
                }
            }
            view.webChromeClient = object : WebChromeClient() {
                override fun onJsAlert(v: WebView, url: String?, message: String?, result: android.webkit.JsResult): Boolean {
                    result.cancel()
                    return true
                }

                override fun onJsConfirm(v: WebView, url: String?, message: String?, result: android.webkit.JsResult): Boolean {
                    result.cancel()
                    return true
                }
            }
            view.loadUrl(start.toString())
            // Slow pages: take what has loaded so far rather than give up.
            main.postDelayed({ if (!closed && isPublisher(view.url)) grab(0) }, 14000)
        }

        done.await(24, TimeUnit.SECONDS)
        main.post {
            closed = true
            probe?.let {
                root.removeView(it)
                it.destroy()
            }
        }
        val page = html?.takeIf { it.length > 2 && it != "null" } ?: return respond(504, "Gateway Timeout", ByteArray(0))
        // evaluateJavascript already returns the HTML as a JSON string literal.
        val json = "{\"url\":" + JSONObject.quote(finalUrl ?: start.toString()) + ",\"html\":" + page + "}"
        return respond(200, "OK", json.toByteArray())
    }

    inner class Bridge {
        /** Matches the system bars to the section being shown. */
        @JavascriptInterface
        fun theme(color: String) {
            val parsed = try { android.graphics.Color.parseColor(color) } catch (_: Exception) { return }
            main.post {
                window.statusBarColor = parsed
                window.navigationBarColor = parsed
            }
        }

        @JavascriptInterface
        fun share(title: String, url: String) {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "$title\n$url")
            main.post { startActivity(Intent.createChooser(send, null)) }
        }
    }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
        const val MAX_REDIRECTS = 6
        const val MAX_BODY = 6 * 1024 * 1024
    }
}
