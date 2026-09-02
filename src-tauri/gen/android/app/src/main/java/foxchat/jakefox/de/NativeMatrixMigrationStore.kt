package foxchat.jakefox.de

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64

/**
 * Durable transaction record for the Android-only hand-off from matrix-js-sdk crypto to the
 * Matrix Rust SDK. A state is deliberately never inferred from files on disk: only READY means
 * the WebView may start without crypto.
 */
object NativeMatrixMigrationStore {
    private const val PREFS = "foxchat_native_matrix"
    private const val ACCOUNTS = "accounts"

    enum class State(val wireName: String) {
        LEGACY("legacy"),
        STAGED("staged"),
        ADOPTING("adopting"),
        VALIDATING("validating"),
        READY("ready"),
        ERROR("error"),
    }

    data class StoredAccount(
        val userId: String,
        val state: State,
        val session: JSONObject?,
        val secretsBundle: String?,
        val backupInfo: String?,
        val storePassphrase: String,
        val startedAt: Long,
        val completedAt: Long,
        val error: String?,
    )

    @Synchronized
    fun stage(
        context: Context,
        session: JSONObject,
        secretsBundle: String?,
        backupInfo: String?,
        storePassphrase: String? = null,
    ) {
        val userId = session.getString("userId")
        val prefs = preferences(context)
        val editor = prefs.edit()
            .putString("$userId.session", session.toString())
            .putString("$userId.state", State.STAGED.wireName)
            .putLong("$userId.startedAt", System.currentTimeMillis())
            .remove("$userId.completedAt")
            .remove("$userId.error")
        if (!secretsBundle.isNullOrBlank() && !backupInfo.isNullOrBlank()) {
            editor
                .putString("$userId.secretsBundle", secretsBundle)
                .putString("$userId.backupInfo", backupInfo)
        }
        if (!storePassphrase.isNullOrBlank()) {
            editor.putString("$userId.storePassphrase", storePassphrase)
        } else if (!prefs.contains("$userId.storePassphrase")) {
            val secret = ByteArray(32).also(SecureRandom()::nextBytes)
            editor.putString("$userId.storePassphrase", Base64.encodeToString(secret, Base64.NO_WRAP))
        }
        val accounts = prefs.getStringSet(ACCOUNTS, emptySet()).orEmpty().toMutableSet()
        accounts.add(userId)
        editor.putStringSet(ACCOUNTS, accounts).commit()
    }

    @Synchronized
    fun setState(context: Context, userId: String, state: State, error: Throwable? = null) {
        val editor = preferences(context).edit()
            .putString("$userId.state", state.wireName)
            .putString("$userId.error", error?.let { it.message ?: it.javaClass.simpleName })
        if (state == State.READY) editor.putLong("$userId.completedAt", System.currentTimeMillis())
        editor.commit()
    }

    @Synchronized
    fun updateSession(context: Context, session: JSONObject) {
        preferences(context).edit()
            .putString("${session.getString("userId")}.session", session.toString())
            .commit()
    }

    @Synchronized
    fun clearMigrationSecrets(context: Context, userId: String) {
        preferences(context).edit()
            .remove("$userId.secretsBundle")
            .remove("$userId.backupInfo")
            .commit()
    }

    fun account(context: Context, userId: String): StoredAccount? {
        val prefs = preferences(context)
        if (!prefs.getStringSet(ACCOUNTS, emptySet()).orEmpty().contains(userId)) return null
        val stateName = prefs.getString("$userId.state", State.LEGACY.wireName)
        val state = State.entries.firstOrNull { it.wireName == stateName } ?: State.ERROR
        val rawSession = prefs.getString("$userId.session", null)
        return StoredAccount(
            userId = userId,
            state = state,
            session = rawSession?.let { runCatching { JSONObject(it) }.getOrNull() },
            secretsBundle = prefs.getString("$userId.secretsBundle", null),
            backupInfo = prefs.getString("$userId.backupInfo", null),
            storePassphrase = prefs.getString("$userId.storePassphrase", null).orEmpty(),
            startedAt = prefs.getLong("$userId.startedAt", 0L),
            completedAt = prefs.getLong("$userId.completedAt", 0L),
            error = prefs.getString("$userId.error", null),
        )
    }

    fun accounts(context: Context): List<StoredAccount> =
        preferences(context).getStringSet(ACCOUNTS, emptySet()).orEmpty()
            .sorted()
            .mapNotNull { account(context, it) }

    fun isReady(context: Context, userId: String): Boolean =
        account(context, userId)?.state == State.READY

    @Synchronized
    fun removeAccount(context: Context, userId: String) {
        val prefs = preferences(context)
        val accounts = prefs.getStringSet(ACCOUNTS, emptySet()).orEmpty().toMutableSet()
        accounts.remove(userId)
        prefs.edit()
            .putStringSet(ACCOUNTS, accounts)
            .remove("$userId.session")
            .remove("$userId.state")
            .remove("$userId.storePassphrase")
            .remove("$userId.startedAt")
            .remove("$userId.completedAt")
            .remove("$userId.error")
            .remove("$userId.secretsBundle")
            .remove("$userId.backupInfo")
            .commit()
    }

    fun status(context: Context): JSONObject = JSONObject().apply {
        put("available", true)
        put("owner", "matrix-rust-sdk")
        put("accounts", JSONArray(accounts(context).map { account ->
            JSONObject()
                .put("userId", account.userId)
                .put("state", account.state.wireName)
                .put("deviceId", account.session?.optString("deviceId"))
                .put("startedAt", account.startedAt)
                .put("completedAt", account.completedAt)
                .put("error", account.error)
        }))
    }

    fun storeDirectoryName(userId: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(userId.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun preferences(context: Context) = EncryptedSharedPreferences.create(
        context,
        PREFS,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
}
