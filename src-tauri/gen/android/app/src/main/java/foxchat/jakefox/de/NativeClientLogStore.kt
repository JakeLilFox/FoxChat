package foxchat.jakefox.de

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/** A small durable ring buffer for errors already shown to the user by the WebView. */
object NativeClientLogStore {
    private const val TAG = "FoxChatWebError"
    private const val PREFS = "foxchat_client_errors"
    private const val ENTRIES = "entries"
    private const val MAX_ENTRIES = 30
    private const val MAX_DETAILS = 12_000
    private val bearerToken = Regex("(?i)\\bBearer\\s+[A-Za-z0-9._~+/-]+=*")
    private val matrixToken = Regex("(?i)\\bsyt_[A-Za-z0-9._~-]+")
    private val secretQuery = Regex("(?i)([?&](?:access_token|refresh_token|password|key)=)[^&\\s]+")

    private fun redact(value: String): String = value
        .replace(bearerToken, "Bearer [redacted]")
        .replace(matrixToken, "[redacted Matrix token]")
        .replace(secretQuery, "${'$'}1[redacted]")

    @Synchronized
    fun record(context: Context, rawPayload: String) {
        val supplied = runCatching { JSONObject(rawPayload) }.getOrElse {
            JSONObject().put("summary", rawPayload)
        }
        val entry = JSONObject()
            .put("at", supplied.opt("at") ?: System.currentTimeMillis())
            .put("context", redact(supplied.optString("context", "webview")))
            .put("summary", redact(supplied.optString("summary", "Unknown WebView error")))
            .put("details", supplied.opt("details")?.toString()?.let(::redact)?.take(MAX_DETAILS))
            .put("callSite", redact(supplied.optString("callSite")).take(MAX_DETAILS))
        val logText = buildString {
            append(entry.optString("context"))
            append(": ")
            append(entry.optString("summary"))
            entry.opt("details")?.takeUnless { it == JSONObject.NULL }?.let {
                append('\n')
                append(it.toString().take(MAX_DETAILS))
            }
            entry.optString("callSite").takeIf { it.isNotBlank() }?.let {
                append('\n')
                append(it)
            }
        }
        Log.e(TAG, logText.take(MAX_DETAILS))

        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val previous = runCatching {
            JSONArray(preferences.getString(ENTRIES, "[]"))
        }.getOrDefault(JSONArray())
        val next = JSONArray()
        val first = (previous.length() - (MAX_ENTRIES - 1)).coerceAtLeast(0)
        for (index in first until previous.length()) previous.optJSONObject(index)?.let(next::put)
        next.put(entry)
        preferences.edit().putString(ENTRIES, next.toString()).commit()
    }

    fun recordNative(context: Context, source: String, error: Throwable) {
        record(
            context,
            JSONObject()
                .put("at", System.currentTimeMillis())
                .put("context", source)
                .put("summary", error.message ?: error.javaClass.simpleName)
                .put("details", Log.getStackTraceString(error))
                .toString(),
        )
    }

    fun entries(context: Context): JSONArray = runCatching {
        JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ENTRIES, "[]"))
    }.getOrDefault(JSONArray())
}
