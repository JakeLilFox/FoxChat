// This list generates the Tauri ACL entries for both Rust commands and
// Android-only Kotlin commands. A @Command method is still rejected before it
// reaches Android unless it is declared here and included in a capability.
const COMMANDS: &[&str] = &[
  "get_token",
  "request_permission",
  "clear_room_notification",
  "update_notification",
  "sync_native_crypto",
  "native_crypto_status",
  "native_session_tokens",
  "native_matrix",
  "test_native_crypto",
  "test_android_auto_notification",
  // Inherited from Tauri's Android Plugin base class and required by
  // @tauri-apps/api/core.addPluginListener.
  "register_listener",
  "remove_listener",
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
