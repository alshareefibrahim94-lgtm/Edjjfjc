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
 *   /resolve?url=…  follows a news-aggregator redirect link to the real article URL
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
                    "/resolve" -> resolve(uri.getQueryParameter("url"))
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
     * News-aggregator links only reveal the real article address after running
     * their page script, so load the link in a throwaway WebView and report the
     * first address it navigates to outside the aggregator.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun resolve(raw: String?): WebResourceResponse {
        val start = httpUrl(raw) ?: return respond(400, "Bad Request", ByteArray(0))
        val done = CountDownLatch(1)
        var found: String? = null
        var probe: WebView? = null

        main.post {
            val view = WebView(this)
            probe = view
            view.settings.javaScriptEnabled = true
            view.settings.blockNetworkImage = true
            view.webViewClient = object : WebViewClient() {
                fun check(candidate: String?): Boolean {
                    val host = try { Uri.parse(candidate).host ?: "" } catch (_: Exception) { "" }
                    if (host.isEmpty() || host.endsWith("google.com") || host.endsWith("bing.com")) return false
                    found = candidate
                    done.countDown()
                    return true
                }

                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest) =
                    request.isForMainFrame && check(request.url.toString())

                override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    if (check(url)) v.stopLoading()
                }
            }
            view.loadUrl(start.toString())
        }

        done.await(15, TimeUnit.SECONDS)
        main.post { probe?.destroy() }
        val url = found ?: return respond(504, "Gateway Timeout", ByteArray(0))
        return respond(200, "OK", JSONObject().put("url", url).toString().toByteArray())
    }

    inner class Bridge {
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
